import {
  DAY_MS,
  addDaysKey,
  parseKey,
  rangeKeys,
  toDateKey,
  todayKey,
  weekdayCn,
} from './date';
import { buildAggregateInsights, buildRepoInsights } from './insights';
import { effectiveMode } from './sync';
import {
  getCommitDays,
  getCommitTotalForRange,
  getCommunityInfo,
  getContributors,
  getIssuePrDaily,
  getLanguages,
  getParticipationWeeks,
  getReleases,
  getStatSnapshots,
  getTrafficDaily,
  getTrafficPaths,
  getTrafficReferrers,
  getTotalsForRange,
} from './metrics-store';
import type {
  AggregateMetrics,
  CommitPoint,
  DataMode,
  LanguageShare,
  ReleaseRow,
  RepoMetrics,
  RepoRankRow,
  RepoSummary,
} from './types';

/**
 * 业务计算层：派指指标口径唯一实现（契约 §9）。
 *
 * - 所有比例字段为 0~1 小数（契约 §5），格式化交给前端 `format.pct`。
 * - 按日序列的补齐已在 metrics-store 层完成，本层不再补点。
 * - RepoMetrics 中 `issues` 不包含 avgCloseHours / avgMergeHours（契约 §5），
 *   这两个量仅作为 `computeHealthScore` 的内部输入，估算口径见
 *   `estimateAvgCloseHours` 的注释。
 */

const MAX_DAYS = 3660;
const CONTRIBUTOR_DISPLAY_LIMIT = 20;

function normalizeDays(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return 30;
  return Math.min(MAX_DAYS, Math.trunc(days));
}

function toInt(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function sumBy<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((acc, row) => acc + toInt(pick(row)), 0);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 契约 §9：`cloneRate = clones / max(1, views)`，views 为 0 时取 0。 */
function computeCloneRate(clones: number, views: number): number {
  if (views <= 0) return 0;
  return clones / Math.max(1, views);
}

function rangeFor(days: number): { days: number; from: string; to: string } {
  const to = todayKey();
  const from = addDaysKey(to, -(days - 1));
  return { days, from, to };
}

/** 前一等长区间：[from-1-days+1, from-1]。 */
function previousRange(fromKey: string, days: number): { from: string; to: string } {
  const to = addDaysKey(fromKey, -1);
  const from = addDaysKey(to, -(days - 1));
  return { from, to };
}

/**
 * 契约 §9 的响应速度分量需要平均关闭时长，但 §5 的 `RepoMetrics.issues` 不暴露该字段，
 * 本地也没有逐条 createdAt/closedAt。契约明确规定「`avgCloseHours` 无法获得时按 168 处理」，
 * 因此这里不自行估算（估算会让 healthScore 系统性偏高），统一返回 null。
 */
function resolveAvgCloseHours(): number | null {
  return null;
}

/** 契约 §9：releaseCadenceDays = 按 publishedAt 倒序相邻间隔的中位数，样本 < 2 → null。 */
function computeReleaseCadence(releases: ReleaseRow[]): number | null {
  const stamps: number[] = [];
  for (const release of releases) {
    if (!release.publishedAt) continue;
    try {
      stamps.push(parseKey(toDateKey(release.publishedAt)).getTime());
    } catch {
      // 非法时间直接忽略，不影响其余样本
    }
  }
  if (stamps.length < 2) return null;
  stamps.sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < stamps.length; i += 1) {
    gaps.push((stamps[i] - stamps[i - 1]) / DAY_MS);
  }
  return gaps.length > 0 ? median(gaps) : null;
}

/** 契约 §9：`activity.commits` 按周几聚合求和最大的中文星期，无数据 → null。 */
function computeBusiestWeekday(commits: CommitPoint[]): string | null {
  const buckets = new Map<string, number>();
  let total = 0;
  for (const point of commits) {
    const weekday = weekdayCn(point.date);
    buckets.set(weekday, (buckets.get(weekday) ?? 0) + toInt(point.count));
    total += toInt(point.count);
  }
  if (total <= 0) return null;
  let best: string | null = null;
  let bestValue = -1;
  // 固定「周一..周日」顺序遍历，保证并列时结果稳定
  for (const weekday of ['周一', '周二', '周三', '周四', '周五', '周六', '周日']) {
    const value = buckets.get(weekday) ?? 0;
    if (value > bestValue) {
      best = weekday;
      bestValue = value;
    }
  }
  return best;
}

function currentMode(): DataMode {
  // 统一走 sync.ts 的 effectiveMode()：除了 env Token，还要包含 `gh auth token` 的回退，
  // 否则本机只登录 gh CLI 时会被误判为 demo（数据其实是真实采集的）。
  return effectiveMode();
}

/** 契约 §9 healthScore 公式。 */
export function computeHealthScore(input: {
  views: number;
  avgCommitsPerDay: number;
  mergeRate: number;
  avgCloseHours: number | null;
  healthPercentage: number | null;
}): number {
  const views = Number.isFinite(input.views) ? Math.max(0, input.views) : 0;
  const traffic = Math.min(100, (100 * Math.log1p(views)) / Math.log1p(5000));

  const avgCommitsPerDay = Number.isFinite(input.avgCommitsPerDay)
    ? Math.max(0, input.avgCommitsPerDay)
    : 0;
  const activity = Math.min(100, (100 * avgCommitsPerDay) / 3);

  const mergeRate = clamp01(input.mergeRate);
  const avgCloseHours =
    input.avgCloseHours !== null && Number.isFinite(input.avgCloseHours)
      ? Math.max(0, input.avgCloseHours)
      : 168;
  const responsiveness = Math.round(
    mergeRate * 60 + Math.max(0, 1 - Math.min(1, avgCloseHours / 336)) * 40,
  );

  const community =
    input.healthPercentage !== null && Number.isFinite(input.healthPercentage)
      ? Math.min(100, Math.max(0, input.healthPercentage))
      : 50;

  const score = 0.3 * traffic + 0.3 * activity + 0.2 * responsiveness + 0.2 * community;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function buildRepoMetrics(repo: RepoSummary, days: number): Omit<RepoMetrics, 'insights'> {
  const range = rangeFor(days);
  const previous = previousRange(range.from, days);

  // ---- Traffic ----
  const daily = getTrafficDaily(repo.id, range.from, range.to);
  const totals = getTotalsForRange(repo.id, range.from, range.to);
  const previousTotals = getTotalsForRange(repo.id, previous.from, previous.to);
  const cloneRate = computeCloneRate(totals.clones, totals.views);

  // ---- Activity ----
  const commits = getCommitDays(repo.id, range.from, range.to);
  const totalCommits = sumBy(commits, (point) => point.count);
  const avgCommitsPerDay = totalCommits / days;
  const weekly = getParticipationWeeks(repo.id, Math.max(1, Math.ceil(days / 7)));
  const contributors = getContributors(repo.id, CONTRIBUTOR_DISPLAY_LIMIT);
  const busiestWeekday = computeBusiestWeekday(commits);

  // ---- Issues / PR ----
  const issueDaily = getIssuePrDaily(repo.id, range.from, range.to);
  const issueTotals = {
    issuesOpened: sumBy(issueDaily, (point) => point.issuesOpened),
    issuesClosed: sumBy(issueDaily, (point) => point.issuesClosed),
    prOpened: sumBy(issueDaily, (point) => point.prOpened),
    prMerged: sumBy(issueDaily, (point) => point.prMerged),
    prClosed: sumBy(issueDaily, (point) => point.prClosed),
  };
  const closeRate = issueTotals.issuesClosed / Math.max(1, issueTotals.issuesOpened);
  const mergeRate = issueTotals.prMerged / Math.max(1, issueTotals.prOpened + issueTotals.prMerged);
  const staleOpenIssues = Math.max(0, repo.openIssues - issueTotals.issuesClosed);

  // ---- Overview ----
  const statsTrend = getStatSnapshots(repo.id, range.from, range.to);
  const starDelta =
    statsTrend.length >= 1
      ? toInt(statsTrend[statsTrend.length - 1].stars) - toInt(statsTrend[0].stars)
      : 0;
  const languages = getLanguages(repo.id);
  const releases = getReleases(repo.id, 12);
  const releaseCadenceDays = computeReleaseCadence(releases);
  const community = getCommunityInfo(repo.id);

  const healthScore = computeHealthScore({
    views: totals.views,
    avgCommitsPerDay,
    mergeRate,
    avgCloseHours: resolveAvgCloseHours(),
    healthPercentage: community?.healthPercentage ?? null,
  });

  return {
    repo,
    mode: currentMode(),
    range,
    traffic: {
      totals,
      previousTotals,
      daily,
      referrers: getTrafficReferrers(repo.id, 8),
      paths: getTrafficPaths(repo.id, 8),
      cloneRate,
    },
    activity: {
      commits,
      totalCommits,
      avgCommitsPerDay,
      weekly,
      contributors,
      busiestWeekday,
    },
    issues: {
      daily: issueDaily,
      totals: issueTotals,
      openIssues: repo.openIssues,
      closeRate,
      mergeRate,
      staleOpenIssues,
    },
    overview: {
      stars: repo.stars,
      forks: repo.forks,
      watchers: repo.watchers,
      openIssues: repo.openIssues,
      starDelta,
      statsTrend,
      languages,
      releases,
      releaseCadenceDays,
      community,
    },
    healthScore,
  };
}

export function computeRepoMetrics(repo: RepoSummary, days: number): RepoMetrics {
  const safeDays = normalizeDays(days);
  const base = buildRepoMetrics(repo, safeDays);
  return { ...base, insights: buildRepoInsights(base, safeDays) };
}

function mergeLanguageMix(repos: Omit<RepoMetrics, 'insights'>[]): LanguageShare[] {
  const bytesByLanguage = new Map<string, number>();
  for (const metrics of repos) {
    for (const share of metrics.overview.languages) {
      bytesByLanguage.set(
        share.language,
        (bytesByLanguage.get(share.language) ?? 0) + toInt(share.bytes),
      );
    }
  }
  const total = [...bytesByLanguage.values()].reduce((acc, bytes) => acc + bytes, 0);
  return [...bytesByLanguage.entries()]
    .map(([language, bytes]) => ({
      language,
      bytes,
      percent: total > 0 ? Math.round((bytes / total) * 1e6) / 1e6 : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes || a.language.localeCompare(b.language));
}

export function computeAggregate(repos: RepoSummary[], days: number): AggregateMetrics {
  const safeDays = normalizeDays(days);
  const range = rangeFor(safeDays);
  const previous = previousRange(range.from, safeDays);

  const trendMap = new Map<
    string,
    { date: string; views: number; clones: number; commits: number }
  >();
  for (const key of rangeKeys(safeDays, range.to)) {
    trendMap.set(key, { date: key, views: 0, clones: 0, commits: 0 });
  }

  let views = 0;
  let uniqueVisitors = 0;
  let clones = 0;
  let commits = 0;
  let stars = 0;
  let starDelta = 0;
  let openIssues = 0;
  let prMerged = 0;
  let issuesClosed = 0;
  let previousViews = 0;
  let previousClones = 0;
  let previousCommits = 0;
  let previousStars = 0;

  const contributorLogins = new Set<string>();
  const perRepo: RepoRankRow[] = [];
  const healthWeights: { views: number; healthScore: number }[] = [];
  const repoSlices: Omit<RepoMetrics, 'insights'>[] = [];

  for (const repo of repos) {
    const metrics = buildRepoMetrics(repo, safeDays);
    repoSlices.push(metrics);

    const repoViews = metrics.traffic.totals.views;
    views += repoViews;
    uniqueVisitors += metrics.traffic.totals.uniqueVisitors;
    clones += metrics.traffic.totals.clones;
    commits += metrics.activity.totalCommits;
    stars += repo.stars;
    starDelta += metrics.overview.starDelta;
    openIssues += repo.openIssues;
    prMerged += metrics.issues.totals.prMerged;
    issuesClosed += metrics.issues.totals.issuesClosed;
    previousViews += metrics.traffic.previousTotals.views;
    previousClones += metrics.traffic.previousTotals.clones;
    previousCommits += getCommitTotalForRange(repo.id, previous.from, previous.to);
    // 上期期末的 stars = 当前 stars - 区间增量
    previousStars += repo.stars - metrics.overview.starDelta;

    for (const point of metrics.traffic.daily) {
      const bucket = trendMap.get(point.date);
      if (bucket) {
        bucket.views += toInt(point.views);
        bucket.clones += toInt(point.clones);
      }
    }
    for (const point of metrics.activity.commits) {
      const bucket = trendMap.get(point.date);
      if (bucket) bucket.commits += toInt(point.count);
    }

    // 贡献者是「按 login 去重人数」，需要用全量名单而不是展示用的截断列表
    for (const contributor of getContributors(repo.id)) {
      contributorLogins.add(contributor.login.toLowerCase());
    }

    perRepo.push({
      fullName: repo.fullName,
      stars: repo.stars,
      starDelta: metrics.overview.starDelta,
      views: repoViews,
      clones: metrics.traffic.totals.clones,
      cloneRate: metrics.traffic.cloneRate,
      commits: metrics.activity.totalCommits,
      prMerged: metrics.issues.totals.prMerged,
      mergeRate: metrics.issues.mergeRate,
      openIssues: repo.openIssues,
      healthScore: metrics.healthScore,
    });
    healthWeights.push({ views: repoViews, healthScore: metrics.healthScore });
  }

  perRepo.sort((a, b) => b.views - a.views || a.fullName.localeCompare(b.fullName));

  const overallHealthScore = (() => {
    if (healthWeights.length === 0) return 0;
    const totalViews = healthWeights.reduce((acc, item) => acc + item.views, 0);
    if (totalViews > 0) {
      const weighted = healthWeights.reduce(
        (acc, item) => acc + item.healthScore * item.views,
        0,
      );
      return Math.round(weighted / totalViews);
    }
    const mean =
      healthWeights.reduce((acc, item) => acc + item.healthScore, 0) / healthWeights.length;
    return Math.round(mean);
  })();

  const base: Omit<AggregateMetrics, 'insights'> = {
    mode: currentMode(),
    range,
    overall: {
      repos: repos.length,
      views,
      uniqueVisitors,
      clones,
      cloneRate: computeCloneRate(clones, views),
      commits,
      stars,
      starDelta,
      openIssues,
      prMerged,
      issuesClosed,
      contributors: contributorLogins.size,
      healthScore: overallHealthScore,
    },
    previous: {
      views: previousViews,
      clones: previousClones,
      commits: previousCommits,
      stars: previousStars,
    },
    trend: [...trendMap.values()],
    perRepo,
    languageMix: mergeLanguageMix(repoSlices),
  };

  return { ...base, insights: buildAggregateInsights(base, repos, safeDays) };
}

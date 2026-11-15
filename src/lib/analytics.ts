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
  getAllParticipationWeeks,
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
  CodeDeltaTotals,
  CodeLanguageStat,
  CodeMetrics,
  CodeWeekPoint,
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

/* ------------------------------------------------------------------ *
 * 代码量估算（GitHub 不提供真实 LOC）
 *
 * 两条真实数据来源：
 * 1. `repo_languages` 只给每种语言的字节数；
 * 2. `participation_weeks` 已存每周 additions / deletions（deletions 为绝对值）。
 *
 * 行数由「每行平均字节数」系数换算，属**估算值**（`isEstimated` 恒为 true），
 * 因此 UI 必须标注「估算」，不能当作 cloc/tokei 级别的精确统计。
 * ------------------------------------------------------------------ */

/**
 * 各语言每行平均字节数的换算系数（用于 LOC 估算，公开给文档与 UI 展示）。
 *
 * 取值依据：按主流格式化风格下的平均行长估算——缩进 2/4 空格 + 常见行宽 80~100 列，
 * 语法的样板字节（括号、分号、类型注解、关键字）越多，每行字节数越高；
 * Markdown / SQL 这类偏文本或长语句的语言更高，CSS / JSON / Dockerfile 这类短行更密。
 */
export const LANGUAGE_BYTES_PER_LINE: Record<string, number> = {
  TypeScript: 32,
  JavaScript: 32,
  Python: 38,
  Go: 30,
  Rust: 34,
  Java: 36,
  Kotlin: 34,
  C: 30,
  'C++': 32,
  'C#': 34,
  Ruby: 30,
  PHP: 32,
  Swift: 30,
  Dart: 32,
  Scala: 34,
  Shell: 30,
  PowerShell: 32,
  CSS: 26,
  SCSS: 26,
  HTML: 30,
  Vue: 32,
  Svelte: 32,
  SQL: 38,
  Markdown: 45,
  JSON: 30,
  YAML: 30,
  Dockerfile: 26,
  Makefile: 28,
  Nix: 30,
  Lua: 30,
  Elixir: 32,
  Haskell: 32,
  Zig: 32,
  Solidity: 34,
};

export const DEFAULT_BYTES_PER_LINE = 34;

/** 语言名归一后的查表索引（`C++` / `C#` 归一后键保持不变，只做小写）。 */
const BYTES_PER_LINE_LOOKUP = new Map<string, number>(
  Object.entries(LANGUAGE_BYTES_PER_LINE).map(([language, bytesPerLine]) => [
    language.toLowerCase(),
    bytesPerLine,
  ]),
);

function resolveBytesPerLine(language: string): number {
  const trimmed = (language ?? '').trim();
  if (trimmed === '') return DEFAULT_BYTES_PER_LINE;
  // 先精确匹配（保留 C++ / C# 这类含符号的写法），再回退到小写归一
  const exact = LANGUAGE_BYTES_PER_LINE[trimmed];
  if (typeof exact === 'number') return exact;
  return BYTES_PER_LINE_LOOKUP.get(trimmed.toLowerCase()) ?? DEFAULT_BYTES_PER_LINE;
}

/** 字节数 → 估算行数；bytes <= 0 或非法 → 0。 */
export function estimateCodeLines(bytes: number, language: string): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  const bytesPerLine = Math.max(1, resolveBytesPerLine(language));
  return Math.round(bytes / bytesPerLine);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function emptyCodeDeltaTotals(): CodeDeltaTotals {
  return { additions: 0, deletions: 0, net: 0 };
}

/** 考量 `days` 窗口的代码量估算；无语言 / 无周数据时返回结构完整的零值对象。 */
export function computeCodeMetrics(
  repoId: number,
  languages: LanguageShare[],
  days: number,
): CodeMetrics {
  const safeDays = normalizeDays(days);

  // ---- 按语言估算行数 ----
  const byLanguage: CodeLanguageStat[] = [];
  let totalBytes = 0;
  let totalLines = 0;
  for (const share of languages) {
    const bytes = Math.max(0, toInt(share.bytes));
    const lines = estimateCodeLines(bytes, share.language);
    totalBytes += bytes;
    totalLines += lines;
    byLanguage.push({ language: share.language, bytes, lines, percent: 0 });
  }
  const lineDenominator = Math.max(1, totalLines);
  for (const stat of byLanguage) {
    // 契约 §5：比例字段统一为 0~1 小数，格式化由前端负责
    stat.percent = Math.round((stat.lines / lineDenominator) * 1e6) / 1e6;
  }
  // 按估算行数降序；lines 为 0 的语言自然排在最后（仍保留，说明是小文件）
  byLanguage.sort(
    (a, b) => b.lines - a.lines || b.bytes - a.bytes || a.language.localeCompare(b.language),
  );
  const bytesPerLine = round1(totalBytes / lineDenominator);

  // ---- 逐周净增与累计曲线（存量指标，不按 days 截断）----
  const weekly: CodeWeekPoint[] = [];
  let cumulative = 0;
  for (const row of getAllParticipationWeeks(repoId)) {
    const additions = Math.max(0, toInt(row.additions));
    const deletions = Math.max(0, toInt(row.deletions));
    const net = additions - deletions;
    cumulative += net;
    weekly.push({ weekStart: row.weekStart, additions, deletions, net, cumulative });
  }

  // ---- 近 days 天的净增（周粒度，含本周）----
  const cutoff = addDaysKey(todayKey(), -(safeDays - 1));
  const last30d = emptyCodeDeltaTotals();
  for (const point of weekly) {
    if (point.weekStart < cutoff) continue;
    last30d.additions += point.additions;
    last30d.deletions += point.deletions;
    last30d.net += point.net;
  }

  // ---- 最近 52 周平均净增 / 单周净增峰值 ----
  const recentWeeks = weekly.slice(-52);
  const avgWeeklyNet =
    recentWeeks.length > 0
      ? round1(recentWeeks.reduce((acc, point) => acc + point.net, 0) / recentWeeks.length)
      : 0;

  // 取 |net| 最大的一周；全部为 0（无增减数据）时视为「没有峰值」，返回 null。
  let peakWeek: CodeWeekPoint | null = null;
  for (const point of weekly) {
    if (Math.abs(point.net) === 0) continue;
    if (peakWeek === null || Math.abs(point.net) > Math.abs(peakWeek.net)) peakWeek = point;
  }

  return {
    estimatedLines: totalLines,
    bytesPerLine,
    isEstimated: true,
    byLanguage,
    weekly,
    last30d,
    avgWeeklyNet,
    peakWeek,
  };
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
  // 复用上面的 languages，避免为代码量估算重复查一次 repo_languages
  const code = computeCodeMetrics(repo.id, languages, days);
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
    code,
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

/** 跨仓合并代码量：按语言合并行数/字节重算占比，按周合并净增，日期取并集升序。 */
function mergeCode(
  slices: Omit<RepoMetrics, 'insights'>[],
): AggregateMetrics['code'] {
  const languageTotals = new Map<string, { bytes: number; lines: number }>();
  const weekTotals = new Map<string, { additions: number; deletions: number; net: number }>();
  const last30d = emptyCodeDeltaTotals();
  const perRepo: AggregateMetrics['code']['perRepo'] = [];
  let estimatedLines = 0;

  for (const slice of slices) {
    const code = slice.code;
    estimatedLines += code.estimatedLines;

    for (const stat of code.byLanguage) {
      const bucket = languageTotals.get(stat.language) ?? { bytes: 0, lines: 0 };
      bucket.bytes += toInt(stat.bytes);
      bucket.lines += toInt(stat.lines);
      languageTotals.set(stat.language, bucket);
    }

    for (const point of code.weekly) {
      const bucket = weekTotals.get(point.weekStart) ?? { additions: 0, deletions: 0, net: 0 };
      bucket.additions += toInt(point.additions);
      bucket.deletions += toInt(point.deletions);
      bucket.net += toInt(point.net);
      weekTotals.set(point.weekStart, bucket);
    }

    last30d.additions += code.last30d.additions;
    last30d.deletions += code.last30d.deletions;
    last30d.net += code.last30d.net;

    perRepo.push({
      fullName: slice.repo.fullName,
      estimatedLines: code.estimatedLines,
      net30d: code.last30d.net,
    });
  }

  const lineDenominator = Math.max(1, estimatedLines);
  const byLanguage: CodeLanguageStat[] = [...languageTotals.entries()]
    .map(([language, totals]) => ({
      language,
      bytes: totals.bytes,
      lines: totals.lines,
      percent: Math.round((totals.lines / lineDenominator) * 1e6) / 1e6,
    }))
    .sort((a, b) => b.lines - a.lines || b.bytes - a.bytes || a.language.localeCompare(b.language));

  const weekly = [...weekTotals.entries()]
    .map(([weekStart, totals]) => ({ weekStart, ...totals }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  perRepo.sort(
    (a, b) => b.estimatedLines - a.estimatedLines || a.fullName.localeCompare(b.fullName),
  );

  return { estimatedLines, isEstimated: true, last30d, byLanguage, weekly, perRepo };
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
    code: mergeCode(repoSlices),
    perRepo,
    languageMix: mergeLanguageMix(repoSlices),
  };

  return { ...base, insights: buildAggregateInsights(base, repos, safeDays) };
}

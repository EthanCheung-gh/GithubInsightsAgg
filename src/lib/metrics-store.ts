import { all, get } from './db';
import { diffDays, isDateKey, rangeKeys } from './date';
import type {
  CommitPoint,
  CommunityChecklistItem,
  CommunityInfo,
  ContributorRow,
  IssuePrPoint,
  LanguageShare,
  ParticipationWeekRow,
  ReleaseRow,
  StatPoint,
  TrafficPathRow,
  TrafficPoint,
  TrafficReferrerRow,
  TrafficTotals,
} from './types';

/**
 * 只读数据访问层（不含任何业务计算）。
 *
 * 设计要点（契约 §9 配套要求）：
 * - 所有「按日序列」都在本层补齐区间内缺失的日期，图表不允许断点。
 * - 补零用于可累加的流量/提交/Issue 指标；`repo_stat_snapshots` 是累计快照，
 *   缺失日期用最近一次快照前向填充（起点之前的空档用首条快照回填），
 *   否则图表会出现假的「归零」下坠。
 * - 本层不区分 live / demo（增补 A1：演示数据也写入同一批表）。
 */

const DEFAULT_LIMIT = 10;

function toInt(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }
  return 0;
}

function normalizeLimit(limit: number | undefined, fallback = DEFAULT_LIMIT): number {
  if (limit === undefined) return fallback;
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(0, Math.trunc(limit));
}

/** 生成 [fromKey, toKey] 的完整日期骨架；参数非法或区间倒置时返回空数组。 */
function dateKeysBetween(fromKey: string, toKey: string): string[] {
  if (!isDateKey(fromKey) || !isDateKey(toKey)) return [];
  const span = diffDays(fromKey, toKey);
  if (span < 0) return [];
  return rangeKeys(span + 1, toKey);
}

interface TrafficDailyRow {
  date: string;
  views: number | null;
  unique_visitors: number | null;
  clones: number | null;
  unique_cloners: number | null;
}

export function getTrafficDaily(repoId: number, fromKey: string, toKey: string): TrafficPoint[] {
  const keys = dateKeysBetween(fromKey, toKey);
  if (keys.length === 0) return [];
  const rows = all<TrafficDailyRow>(
    `SELECT date, views, unique_visitors, clones, unique_cloners
       FROM traffic_daily
      WHERE repo_id = ? AND date BETWEEN ? AND ?
      ORDER BY date ASC`,
    [repoId, fromKey, toKey],
  );
  const byDate = new Map<string, TrafficDailyRow>();
  for (const row of rows) byDate.set(row.date, row);
  return keys.map((date) => {
    const row = byDate.get(date);
    return {
      date,
      views: toInt(row?.views),
      uniqueVisitors: toInt(row?.unique_visitors),
      clones: toInt(row?.clones),
      uniqueCloners: toInt(row?.unique_cloners),
    };
  });
}

interface ReferrerRow {
  referrer: string;
  count: number | null;
  uniques: number | null;
}

export function getTrafficReferrers(repoId: number, limit = DEFAULT_LIMIT): TrafficReferrerRow[] {
  const latest = get<{ captured: string | null }>(
    'SELECT MAX(captured_at) AS captured FROM traffic_referrers WHERE repo_id = ?',
    [repoId],
  );
  if (!latest?.captured) return [];
  const rows = all<ReferrerRow>(
    `SELECT referrer, count, uniques
       FROM traffic_referrers
      WHERE repo_id = ? AND captured_at = ?
      ORDER BY count DESC, referrer ASC
      LIMIT ?`,
    [repoId, latest.captured, normalizeLimit(limit)],
  );
  return rows.map((row) => ({
    referrer: row.referrer,
    count: toInt(row.count),
    uniques: toInt(row.uniques),
  }));
}

interface PathRow {
  path: string;
  title: string | null;
  count: number | null;
  uniques: number | null;
}

export function getTrafficPaths(repoId: number, limit = DEFAULT_LIMIT): TrafficPathRow[] {
  const latest = get<{ captured: string | null }>(
    'SELECT MAX(captured_at) AS captured FROM traffic_paths WHERE repo_id = ?',
    [repoId],
  );
  if (!latest?.captured) return [];
  const rows = all<PathRow>(
    `SELECT path, title, count, uniques
       FROM traffic_paths
      WHERE repo_id = ? AND captured_at = ?
      ORDER BY count DESC, path ASC
      LIMIT ?`,
    [repoId, latest.captured, normalizeLimit(limit)],
  );
  return rows.map((row) => ({
    path: row.path,
    title: row.title ?? null,
    count: toInt(row.count),
    uniques: toInt(row.uniques),
  }));
}

interface CommitDayRow {
  date: string;
  count: number | null;
}

export function getCommitDays(repoId: number, fromKey: string, toKey: string): CommitPoint[] {
  const keys = dateKeysBetween(fromKey, toKey);
  if (keys.length === 0) return [];
  const rows = all<CommitDayRow>(
    `SELECT date, count
       FROM commit_days
      WHERE repo_id = ? AND date BETWEEN ? AND ?
      ORDER BY date ASC`,
    [repoId, fromKey, toKey],
  );
  const byDate = new Map<string, number>();
  for (const row of rows) byDate.set(row.date, toInt(row.count));
  return keys.map((date) => ({ date, count: byDate.get(date) ?? 0 }));
}

interface ParticipationRow {
  week_start: string;
  commits: number | null;
  additions: number | null;
  deletions: number | null;
}

export function getParticipationWeeks(repoId: number, weeks: number): ParticipationWeekRow[] {
  const limit = Math.max(1, normalizeLimit(weeks, 1));
  const rows = all<ParticipationRow>(
    `SELECT week_start, commits, additions, deletions
       FROM participation_weeks
      WHERE repo_id = ?
      ORDER BY week_start DESC
      LIMIT ?`,
    [repoId, limit],
  );
  // 返回按时间升序，方便直接喂给图表
  return rows.reverse().map((row) => ({
    weekStart: row.week_start,
    commits: toInt(row.commits),
    additions: toInt(row.additions),
    deletions: toInt(row.deletions),
  }));
}

/**
 * 全量周参与度（不设 LIMIT），按 week_start 升序。
 *
 * 代码量统计需要完整时间轴来算累计净增曲线，因此不能复用 `getParticipationWeeks`
 * 的「近 N 周」截断语义。
 */
export function getAllParticipationWeeks(repoId: number): ParticipationWeekRow[] {
  const rows = all<ParticipationRow>(
    `SELECT week_start, commits, additions, deletions
       FROM participation_weeks
      WHERE repo_id = ?
      ORDER BY week_start ASC`,
    [repoId],
  );
  return rows.map((row) => ({
    weekStart: row.week_start,
    commits: toInt(row.commits),
    additions: toInt(row.additions),
    deletions: toInt(row.deletions),
  }));
}

interface ContributorDbRow {
  login: string;
  avatar_url: string | null;
  contributions: number | null;
  type: string | null;
}

export function getContributors(repoId: number, limit?: number): ContributorRow[] {
  const capped = limit === undefined ? undefined : normalizeLimit(limit);
  const rows = all<ContributorDbRow>(
    `SELECT login, avatar_url, contributions, type
       FROM contributors
      WHERE repo_id = ?
      ORDER BY contributions DESC, login ASC
      ${capped === undefined ? '' : 'LIMIT ?'}`,
    capped === undefined ? [repoId] : [repoId, capped],
  );
  return rows.map((row) => ({
    login: row.login,
    avatarUrl: row.avatar_url ?? null,
    contributions: toInt(row.contributions),
    type: row.type ?? 'User',
  }));
}

interface IssuePrDailyRow {
  date: string;
  issues_opened: number | null;
  issues_closed: number | null;
  pr_opened: number | null;
  pr_merged: number | null;
  pr_closed: number | null;
}

export function getIssuePrDaily(repoId: number, fromKey: string, toKey: string): IssuePrPoint[] {
  const keys = dateKeysBetween(fromKey, toKey);
  if (keys.length === 0) return [];
  const rows = all<IssuePrDailyRow>(
    `SELECT date, issues_opened, issues_closed, pr_opened, pr_merged, pr_closed
       FROM issue_pr_daily
      WHERE repo_id = ? AND date BETWEEN ? AND ?
      ORDER BY date ASC`,
    [repoId, fromKey, toKey],
  );
  const byDate = new Map<string, IssuePrDailyRow>();
  for (const row of rows) byDate.set(row.date, row);
  return keys.map((date) => {
    const row = byDate.get(date);
    return {
      date,
      issuesOpened: toInt(row?.issues_opened),
      issuesClosed: toInt(row?.issues_closed),
      prOpened: toInt(row?.pr_opened),
      prMerged: toInt(row?.pr_merged),
      prClosed: toInt(row?.pr_closed),
    };
  });
}

interface StatRow {
  date: string;
  stars: number | null;
  forks: number | null;
  watchers: number | null;
  open_issues: number | null;
}

export function getStatSnapshots(repoId: number, fromKey: string, toKey: string): StatPoint[] {
  const keys = dateKeysBetween(fromKey, toKey);
  if (keys.length === 0) return [];
  const rows = all<StatRow>(
    `SELECT date, stars, forks, watchers, open_issues
       FROM repo_stat_snapshots
      WHERE repo_id = ? AND date BETWEEN ? AND ?
      ORDER BY date ASC`,
    [repoId, fromKey, toKey],
  );
  const byDate = new Map<string, StatRow>();
  for (const row of rows) byDate.set(row.date, row);

  // 累计值前向填充：缺失日期沿用最近一次快照
  const points: StatPoint[] = [];
  let carry: Omit<StatPoint, 'date'> | null = null;
  for (const date of keys) {
    const row = byDate.get(date);
    if (row) {
      carry = {
        stars: toInt(row.stars),
        forks: toInt(row.forks),
        watchers: toInt(row.watchers),
        openIssues: toInt(row.open_issues),
      };
    }
    points.push(
      carry
        ? { date, ...carry }
        : { date, stars: 0, forks: 0, watchers: 0, openIssues: 0 },
    );
  }

  // 区间起点早于首条快照时，用首条快照回填，避免把起点误读为 0
  if (rows.length > 0) {
    const firstIndex = keys.indexOf(rows[0].date);
    if (firstIndex > 0) {
      const seed: Omit<StatPoint, 'date'> = {
        stars: toInt(rows[0].stars),
        forks: toInt(rows[0].forks),
        watchers: toInt(rows[0].watchers),
        openIssues: toInt(rows[0].open_issues),
      };
      for (let i = 0; i < firstIndex; i += 1) {
        points[i] = { date: keys[i], ...seed };
      }
    }
  }
  return points;
}

interface LanguageRow {
  language: string;
  bytes: number | null;
}

export function getLanguages(repoId: number): LanguageShare[] {
  const rows = all<LanguageRow>(
    `SELECT language, bytes
       FROM repo_languages
      WHERE repo_id = ?
      ORDER BY bytes DESC, language ASC`,
    [repoId],
  );
  const total = rows.reduce((acc, row) => acc + toInt(row.bytes), 0);
  return rows.map((row) => {
    const bytes = toInt(row.bytes);
    return {
      language: row.language,
      bytes,
      // 契约 §5：比例字段统一为 0~1 的小数，格式化由前端负责
      percent: total > 0 ? Math.round((bytes / total) * 1e6) / 1e6 : 0,
    };
  });
}

interface ReleaseDbRow {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  is_prerelease: number | null;
}

export function getReleases(repoId: number, limit = DEFAULT_LIMIT): ReleaseRow[] {
  const rows = all<ReleaseDbRow>(
    `SELECT tag_name, name, published_at, is_prerelease
       FROM releases
      WHERE repo_id = ?
      ORDER BY (published_at IS NULL) ASC, published_at DESC, tag_name ASC
      LIMIT ?`,
    [repoId, normalizeLimit(limit)],
  );
  return rows.map((row) => ({
    tagName: row.tag_name,
    name: row.name ?? null,
    publishedAt: row.published_at ?? null,
    isPrerelease: toInt(row.is_prerelease) === 1,
  }));
}

interface CommunityDbRow {
  health_percentage: number | null;
  has_readme: number | null;
  has_license: number | null;
  has_contributing: number | null;
  has_code_of_conduct: number | null;
  has_issue_template: number | null;
  has_pull_request_template: number | null;
  has_description: number | null;
}

export function getCommunityInfo(repoId: number): CommunityInfo | null {
  const row = get<CommunityDbRow>(
    `SELECT health_percentage, has_readme, has_license, has_contributing,
            has_code_of_conduct, has_issue_template, has_pull_request_template,
            has_description
       FROM community_profiles
      WHERE repo_id = ?`,
    [repoId],
  );
  if (!row) return null;
  const checklist: CommunityChecklistItem[] = [
    { key: 'readme', label: 'README', ok: toInt(row.has_readme) === 1 },
    { key: 'license', label: 'License', ok: toInt(row.has_license) === 1 },
    { key: 'contributing', label: '贡献指南', ok: toInt(row.has_contributing) === 1 },
    { key: 'codeOfConduct', label: '行为准则', ok: toInt(row.has_code_of_conduct) === 1 },
    { key: 'issueTemplate', label: 'Issue 模板', ok: toInt(row.has_issue_template) === 1 },
    {
      key: 'pullRequestTemplate',
      label: 'PR 模板',
      ok: toInt(row.has_pull_request_template) === 1,
    },
    { key: 'description', label: '仓库简介', ok: toInt(row.has_description) === 1 },
  ];
  return { healthPercentage: toInt(row.health_percentage), checklist };
}

interface TrafficTotalsRow {
  views: number | null;
  unique_visitors: number | null;
  clones: number | null;
  unique_cloners: number | null;
}

export function getTotalsForRange(repoId: number, fromKey: string, toKey: string): TrafficTotals {
  const row = get<TrafficTotalsRow>(
    `SELECT SUM(views) AS views,
            SUM(unique_visitors) AS unique_visitors,
            SUM(clones) AS clones,
            SUM(unique_cloners) AS unique_cloners
       FROM traffic_daily
      WHERE repo_id = ? AND date BETWEEN ? AND ?`,
    [repoId, fromKey, toKey],
  );
  return {
    views: toInt(row?.views),
    // 去重访客跨天无法相加，这里按日求和（契约未要求精确去重）
    uniqueVisitors: toInt(row?.unique_visitors),
    clones: toInt(row?.clones),
    uniqueCloners: toInt(row?.unique_cloners),
  };
}

export function getCommitTotalForRange(repoId: number, fromKey: string, toKey: string): number {
  const row = get<{ total: number | null }>(
    'SELECT SUM(count) AS total FROM commit_days WHERE repo_id = ? AND date BETWEEN ? AND ?',
    [repoId, fromKey, toKey],
  );
  return toInt(row?.total);
}

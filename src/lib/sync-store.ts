import { all, getDb, get, transaction } from './db';
import type { DataMode, SyncRunRow } from './types';

/**
 * 采集结果的写库层（只负责 SQL，不做业务判断）。
 *
 * 两类语义：
 * - `upsert*`：按业务唯一键增量合并（traffic_daily / commit_days / 快照），
 *   适合「每次采集只覆盖最近一小段窗口」的数据，避免删掉更早的历史。
 * - `replace*`：`DELETE ... WHERE repo_id = ?` + 批量 INSERT，
 *   适合「每次采集都能拿到全量快照」的数据（来源排行、热门页面、贡献者、
 *   周参与度、Issue/PR 日聚合、Release、语言、社区档案）。
 *
 * 所有写入使用参数化语句，禁止拼接值。
 */

export type SyncRunStatus = 'running' | 'success' | 'partial' | 'error';
export type SyncTrigger = 'manual' | 'cli' | 'api';

/* ------------------------------------------------------------------ */
/* traffic                                                             */
/* ------------------------------------------------------------------ */

export interface TrafficDailyInput {
  date: string;
  views: number;
  uniqueVisitors: number;
  clones: number;
  uniqueCloners: number;
}

export function upsertTrafficDaily(repoId: number, rows: TrafficDailyInput[]): number {
  if (rows.length === 0) return 0;
  return transaction(() => {
    const statement = getDb().prepare(
      `INSERT INTO traffic_daily (repo_id, date, views, unique_visitors, clones, unique_cloners)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (repo_id, date) DO UPDATE SET
         views = excluded.views,
         unique_visitors = excluded.unique_visitors,
         clones = excluded.clones,
         unique_cloners = excluded.unique_cloners`,
    );
    let written = 0;
    for (const row of rows) {
      statement.run(
        repoId,
        row.date,
        row.views,
        row.uniqueVisitors,
        row.clones,
        row.uniqueCloners,
      );
      written += 1;
    }
    return written;
  });
}

export interface TrafficReferrerInput {
  referrer: string;
  count: number;
  uniques: number;
}

export function replaceTrafficReferrers(
  repoId: number,
  capturedAt: string,
  rows: TrafficReferrerInput[],
): number {
  return transaction(() => {
    getDb().prepare('DELETE FROM traffic_referrers WHERE repo_id = ?').run(repoId);
    if (rows.length === 0) return 0;
    const statement = getDb().prepare(
      `INSERT INTO traffic_referrers (repo_id, captured_at, referrer, count, uniques)
       VALUES (?, ?, ?, ?, ?)`,
    );
    let written = 0;
    for (const row of rows) {
      statement.run(repoId, capturedAt, row.referrer, row.count, row.uniques);
      written += 1;
    }
    return written;
  });
}

export interface TrafficPathInput {
  path: string;
  title: string | null;
  count: number;
  uniques: number;
}

export function replaceTrafficPaths(
  repoId: number,
  capturedAt: string,
  rows: TrafficPathInput[],
): number {
  return transaction(() => {
    getDb().prepare('DELETE FROM traffic_paths WHERE repo_id = ?').run(repoId);
    if (rows.length === 0) return 0;
    const statement = getDb().prepare(
      `INSERT INTO traffic_paths (repo_id, captured_at, path, title, count, uniques)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    let written = 0;
    for (const row of rows) {
      statement.run(repoId, capturedAt, row.path, row.title, row.count, row.uniques);
      written += 1;
    }
    return written;
  });
}

/* ------------------------------------------------------------------ */
/* activity                                                            */
/* ------------------------------------------------------------------ */

export interface CommitDayInput {
  date: string;
  count: number;
}

export function upsertCommitDays(repoId: number, rows: CommitDayInput[]): number {
  if (rows.length === 0) return 0;
  return transaction(() => {
    const statement = getDb().prepare(
      `INSERT INTO commit_days (repo_id, date, count)
       VALUES (?, ?, ?)
       ON CONFLICT (repo_id, date) DO UPDATE SET count = excluded.count`,
    );
    let written = 0;
    for (const row of rows) {
      statement.run(repoId, row.date, row.count);
      written += 1;
    }
    return written;
  });
}

export interface ParticipationWeekInput {
  weekStart: string;
  commits: number;
  additions: number;
  deletions: number;
}

export function replaceParticipationWeeks(
  repoId: number,
  rows: ParticipationWeekInput[],
): number {
  return transaction(() => {
    getDb().prepare('DELETE FROM participation_weeks WHERE repo_id = ?').run(repoId);
    if (rows.length === 0) return 0;
    const statement = getDb().prepare(
      `INSERT INTO participation_weeks (repo_id, week_start, commits, additions, deletions)
       VALUES (?, ?, ?, ?, ?)`,
    );
    let written = 0;
    for (const row of rows) {
      statement.run(repoId, row.weekStart, row.commits, row.additions, row.deletions);
      written += 1;
    }
    return written;
  });
}

export interface ContributorInput {
  login: string;
  avatarUrl: string | null;
  contributions: number;
  type: string;
}

export function replaceContributors(
  repoId: number,
  capturedAt: string,
  rows: ContributorInput[],
): number {
  return transaction(() => {
    getDb().prepare('DELETE FROM contributors WHERE repo_id = ?').run(repoId);
    if (rows.length === 0) return 0;
    const statement = getDb().prepare(
      `INSERT INTO contributors (repo_id, login, avatar_url, contributions, type, captured_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    let written = 0;
    for (const row of rows) {
      statement.run(repoId, row.login, row.avatarUrl, row.contributions, row.type, capturedAt);
      written += 1;
    }
    return written;
  });
}

/* ------------------------------------------------------------------ */
/* issues / pr                                                         */
/* ------------------------------------------------------------------ */

export interface IssuePrDailyInput {
  date: string;
  issuesOpened: number;
  issuesClosed: number;
  prOpened: number;
  prMerged: number;
  prClosed: number;
}

export function replaceIssuePrDaily(repoId: number, rows: IssuePrDailyInput[]): number {
  return transaction(() => {
    getDb().prepare('DELETE FROM issue_pr_daily WHERE repo_id = ?').run(repoId);
    if (rows.length === 0) return 0;
    const statement = getDb().prepare(
      `INSERT INTO issue_pr_daily (
         repo_id, date, issues_opened, issues_closed, pr_opened, pr_merged, pr_closed
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    let written = 0;
    for (const row of rows) {
      statement.run(
        repoId,
        row.date,
        row.issuesOpened,
        row.issuesClosed,
        row.prOpened,
        row.prMerged,
        row.prClosed,
      );
      written += 1;
    }
    return written;
  });
}

/* ------------------------------------------------------------------ */
/* overview                                                            */
/* ------------------------------------------------------------------ */

export interface ReleaseInput {
  tagName: string;
  name: string | null;
  publishedAt: string | null;
  isPrerelease: boolean;
}

export function replaceReleases(repoId: number, rows: ReleaseInput[]): number {
  return transaction(() => {
    getDb().prepare('DELETE FROM releases WHERE repo_id = ?').run(repoId);
    if (rows.length === 0) return 0;
    const statement = getDb().prepare(
      `INSERT INTO releases (repo_id, tag_name, name, published_at, is_prerelease)
       VALUES (?, ?, ?, ?, ?)`,
    );
    let written = 0;
    for (const row of rows) {
      statement.run(repoId, row.tagName, row.name, row.publishedAt, row.isPrerelease ? 1 : 0);
      written += 1;
    }
    return written;
  });
}

export interface LanguageInput {
  language: string;
  bytes: number;
}

export function replaceLanguages(repoId: number, rows: LanguageInput[]): number {
  return transaction(() => {
    getDb().prepare('DELETE FROM repo_languages WHERE repo_id = ?').run(repoId);
    if (rows.length === 0) return 0;
    const statement = getDb().prepare(
      `INSERT INTO repo_languages (repo_id, language, bytes) VALUES (?, ?, ?)`,
    );
    let written = 0;
    for (const row of rows) {
      statement.run(repoId, row.language, row.bytes);
      written += 1;
    }
    return written;
  });
}

export interface CommunityProfileStoreInput {
  healthPercentage: number;
  hasReadme: boolean;
  hasLicense: boolean;
  hasContributing: boolean;
  hasCodeOfConduct: boolean;
  hasIssueTemplate: boolean;
  hasPullRequestTemplate: boolean;
  hasDescription: boolean;
}

export function upsertCommunityProfile(
  repoId: number,
  capturedAt: string,
  profile: CommunityProfileStoreInput,
): number {
  return transaction(() => {
    getDb()
      .prepare(
        `INSERT INTO community_profiles (
           repo_id, health_percentage, has_readme, has_license, has_contributing,
           has_code_of_conduct, has_issue_template, has_pull_request_template,
           has_description, captured_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (repo_id) DO UPDATE SET
           health_percentage = excluded.health_percentage,
           has_readme = excluded.has_readme,
           has_license = excluded.has_license,
           has_contributing = excluded.has_contributing,
           has_code_of_conduct = excluded.has_code_of_conduct,
           has_issue_template = excluded.has_issue_template,
           has_pull_request_template = excluded.has_pull_request_template,
           has_description = excluded.has_description,
           captured_at = excluded.captured_at`,
      )
      .run(
        repoId,
        profile.healthPercentage,
        profile.hasReadme ? 1 : 0,
        profile.hasLicense ? 1 : 0,
        profile.hasContributing ? 1 : 0,
        profile.hasCodeOfConduct ? 1 : 0,
        profile.hasIssueTemplate ? 1 : 0,
        profile.hasPullRequestTemplate ? 1 : 0,
        profile.hasDescription ? 1 : 0,
        capturedAt,
      );
    return 1;
  });
}

export interface StatSnapshotInput {
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
}

export function upsertStatSnapshot(
  repoId: number,
  date: string,
  stats: StatSnapshotInput,
): number {
  return transaction(() => {
    getDb()
      .prepare(
        `INSERT INTO repo_stat_snapshots (repo_id, date, stars, forks, watchers, open_issues)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (repo_id, date) DO UPDATE SET
           stars = excluded.stars,
           forks = excluded.forks,
           watchers = excluded.watchers,
           open_issues = excluded.open_issues`,
      )
      .run(repoId, date, stats.stars, stats.forks, stats.watchers, stats.openIssues);
    return 1;
  });
}

/* ------------------------------------------------------------------ */
/* sync_runs                                                           */
/* ------------------------------------------------------------------ */

export function startSyncRun(input: {
  repoId: number | null;
  scope: 'repo' | 'all';
  trigger: SyncTrigger | string;
  mode: DataMode;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO sync_runs (repo_id, scope, status, trigger, started_at, records_written, mode)
       VALUES (?, ?, 'running', ?, ?, 0, ?)`,
    )
    .run(
      input.repoId,
      input.scope,
      input.trigger,
      new Date().toISOString(),
      input.mode,
    );
  return Number(result.lastInsertRowid);
}

export function finishSyncRun(
  runId: number,
  patch: {
    status: Exclude<SyncRunStatus, 'running'>;
    recordsWritten?: number;
    error?: string | null;
    durationMs?: number;
  },
): void {
  const finishedAt = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE sync_runs
          SET status = ?, finished_at = ?, duration_ms = ?, records_written = ?, error = ?
        WHERE id = ?`,
    )
    .run(
      patch.status,
      finishedAt,
      patch.durationMs ?? null,
      patch.recordsWritten ?? 0,
      patch.error ?? null,
      runId,
    );
}

interface SyncRunJoinRow {
  id: number;
  repo_id: number | null;
  repo_full_name: string | null;
  scope: string;
  status: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  records_written: number | null;
  mode: string;
  error: string | null;
}

const SYNC_RUN_SELECT = `
  SELECT r.id            AS id,
         r.repo_id       AS repo_id,
         repos.full_name AS repo_full_name,
         r.scope         AS scope,
         r.status        AS status,
         r.trigger       AS trigger,
         r.started_at    AS started_at,
         r.finished_at   AS finished_at,
         r.duration_ms   AS duration_ms,
         r.records_written AS records_written,
         r.mode          AS mode,
         r.error         AS error
    FROM sync_runs r
    LEFT JOIN repos ON repos.id = r.repo_id
`;

function normalizeStatus(raw: string): SyncRunStatus {
  return raw === 'success' || raw === 'partial' || raw === 'error' ? raw : 'running';
}

function normalizeMode(raw: string): DataMode {
  return raw === 'demo' ? 'demo' : 'live';
}

function mapRunRow(row: SyncRunJoinRow): SyncRunRow {
  return {
    id: row.id,
    repoId: row.repo_id ?? null,
    repoFullName: row.repo_full_name ?? null,
    scope: row.scope,
    // 表里的 TEXT 列需要收敛到契约联合类型（见 SyncRunRow）
    status: normalizeStatus(row.status),
    trigger: row.trigger,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? null,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    recordsWritten: Number(row.records_written ?? 0),
    mode: normalizeMode(row.mode),
    error: row.error ?? null,
  };
}

export function listSyncRuns(limit = 20): SyncRunRow[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 20;
  const rows = all<SyncRunJoinRow>(
    `${SYNC_RUN_SELECT} ORDER BY r.id DESC LIMIT ?`,
    [safeLimit],
  );
  return rows.map(mapRunRow);
}

export function getSyncRunById(id: number): SyncRunRow | null {
  if (!Number.isFinite(id)) return null;
  const row = get<SyncRunJoinRow>(`${SYNC_RUN_SELECT} WHERE r.id = ?`, [Math.trunc(id)]);
  return row ? mapRunRow(row) : null;
}

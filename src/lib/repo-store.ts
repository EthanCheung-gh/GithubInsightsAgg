import { all, get, run, transaction } from './db';
import type { RepoSummary } from './types';

interface RepoRow {
  id: number;
  owner: string;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string | null;
  default_branch: string | null;
  language: string | null;
  topics: string | null;
  is_private: number;
  is_archived: number;
  enabled: number;
  stars: number;
  forks: number;
  watchers: number;
  open_issues: number;
  pushed_at: string | null;
  created_at: string;
  last_synced_at: string | null;
  last_sync_error: string | null;
}

const FULL_NAME_RE = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

function parseTopics(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function toInt(value: number | null | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function mapRow(row: RepoRow): RepoSummary {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    fullName: row.full_name,
    description: row.description ?? null,
    htmlUrl: row.html_url ?? null,
    defaultBranch: row.default_branch ?? null,
    language: row.language ?? null,
    topics: parseTopics(row.topics),
    isPrivate: !!row.is_private,
    isArchived: !!row.is_archived,
    enabled: !!row.enabled,
    stars: toInt(row.stars),
    forks: toInt(row.forks),
    watchers: toInt(row.watchers),
    openIssues: toInt(row.open_issues),
    pushedAt: row.pushed_at ?? null,
    lastSyncedAt: row.last_synced_at ?? null,
    lastSyncError: row.last_sync_error ?? null,
  };
}

export function listRepos(opts?: {
  enabledOnly?: boolean;
  sort?: 'stars' | 'name' | 'synced';
}): RepoSummary[] {
  const enabledOnly = opts?.enabledOnly === true;
  const sort = opts?.sort ?? 'stars';
  const orderBy =
    sort === 'name'
      ? 'full_name COLLATE NOCASE ASC'
      : sort === 'synced'
        ? 'last_synced_at DESC, full_name COLLATE NOCASE ASC'
        : 'stars DESC, full_name COLLATE NOCASE ASC';
  const sql = `SELECT * FROM repos${enabledOnly ? ' WHERE enabled = 1' : ''} ORDER BY ${orderBy}`;
  return all<RepoRow>(sql).map(mapRow);
}

export function getRepoById(id: number): RepoSummary | null {
  const row = get<RepoRow>('SELECT * FROM repos WHERE id = ?', [id]);
  return row ? mapRow(row) : null;
}

export function getRepoByFullName(fullName: string): RepoSummary | null {
  const normalized = normalizeFullName(fullName);
  if (!normalized) return null;
  const row = get<RepoRow>('SELECT * FROM repos WHERE full_name = ? COLLATE NOCASE', [normalized]);
  return row ? mapRow(row) : null;
}

export function normalizeFullName(fullName: string): string | null {
  if (typeof fullName !== 'string') return null;
  const trimmed = fullName.trim();
  if (!trimmed) return null;
  const match = FULL_NAME_RE.exec(trimmed);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

export function insertRepo(input: {
  owner: string;
  name: string;
  description?: string | null;
  htmlUrl?: string | null;
  defaultBranch?: string | null;
  language?: string | null;
  topics?: string[];
  isPrivate?: boolean;
  isArchived?: boolean;
  stars?: number;
  forks?: number;
  watchers?: number;
  openIssues?: number;
  pushedAt?: string | null;
}): RepoSummary {
  const owner = input.owner.trim();
  const name = input.name.trim();
  const fullName = normalizeFullName(`${owner}/${name}`);
  if (!fullName) {
    throw new Error(`invalid repo full name: ${owner}/${name}`);
  }
  const createdAt = new Date().toISOString();
  const result = run(
    `INSERT INTO repos (
      owner, name, full_name, description, html_url, default_branch, language, topics,
      is_private, is_archived, enabled, stars, forks, watchers, open_issues, pushed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    [
      owner,
      name,
      fullName,
      input.description ?? null,
      input.htmlUrl ?? null,
      input.defaultBranch ?? null,
      input.language ?? null,
      JSON.stringify(input.topics ?? []),
      input.isPrivate ? 1 : 0,
      input.isArchived ? 1 : 0,
      toInt(input.stars),
      toInt(input.forks),
      toInt(input.watchers),
      toInt(input.openIssues),
      input.pushedAt ?? null,
      createdAt,
    ],
  );
  const created = getRepoById(result.lastInsertRowid);
  if (!created) {
    throw new Error('failed to read back inserted repo');
  }
  return created;
}

export function updateRepoOverview(
  id: number,
  patch: {
    description?: string | null;
    htmlUrl?: string | null;
    defaultBranch?: string | null;
    language?: string | null;
    topics?: string[];
    isPrivate?: boolean;
    isArchived?: boolean;
    stars?: number;
    forks?: number;
    watchers?: number;
    openIssues?: number;
    pushedAt?: string | null;
  },
): void {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  const push = (column: string, value: string | number | null): void => {
    sets.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.description !== undefined) push('description', patch.description);
  if (patch.htmlUrl !== undefined) push('html_url', patch.htmlUrl);
  if (patch.defaultBranch !== undefined) push('default_branch', patch.defaultBranch);
  if (patch.language !== undefined) push('language', patch.language);
  if (patch.topics !== undefined) push('topics', JSON.stringify(patch.topics));
  if (patch.isPrivate !== undefined) push('is_private', patch.isPrivate ? 1 : 0);
  if (patch.isArchived !== undefined) push('is_archived', patch.isArchived ? 1 : 0);
  if (patch.stars !== undefined) push('stars', toInt(patch.stars));
  if (patch.forks !== undefined) push('forks', toInt(patch.forks));
  if (patch.watchers !== undefined) push('watchers', toInt(patch.watchers));
  if (patch.openIssues !== undefined) push('open_issues', toInt(patch.openIssues));
  if (patch.pushedAt !== undefined) push('pushed_at', patch.pushedAt);

  if (sets.length === 0) return;
  params.push(id);
  run(`UPDATE repos SET ${sets.join(', ')} WHERE id = ?`, params);
}

export function setRepoEnabled(id: number, enabled: boolean): void {
  run('UPDATE repos SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
}

export function deleteRepo(id: number): boolean {
  return transaction(() => run('DELETE FROM repos WHERE id = ?', [id]).changes > 0);
}

export function markSynced(
  id: number,
  opts: { error?: string | null; syncedAt?: string } = {},
): void {
  const syncedAt = opts.syncedAt ?? new Date().toISOString();
  run('UPDATE repos SET last_synced_at = ?, last_sync_error = ? WHERE id = ?', [
    syncedAt,
    opts.error ?? null,
    id,
  ]);
}

export function countRepos(): { total: number; enabled: number } {
  const row = get<{ total: number; enabled: number | null }>(
    'SELECT COUNT(*) AS total, SUM(enabled) AS enabled FROM repos',
  );
  return { total: toInt(row?.total), enabled: toInt(row?.enabled) };
}

export function lastSyncedAt(): string | null {
  const row = get<{ last: string | null }>('SELECT MAX(last_synced_at) AS last FROM repos');
  return row?.last ?? null;
}

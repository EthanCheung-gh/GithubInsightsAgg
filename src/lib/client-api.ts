import type {
  AggregateMetrics,
  ApiError,
  DataMode,
  HealthPayload,
  RepoMetrics,
  RepoSummary,
  SyncRunRow,
} from './types';

/** fetchJson 抛出的错误：message 为接口 error 码（或 HTTP 状态码），并附带原始状态与载荷 */
export interface ApiRequestError extends Error {
  status: number;
  payload: ApiError | null;
}

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { error?: unknown }).error === 'string'
  );
}

/**
 * 统一请求封装：`cache: 'no-store'`；非 2xx 时抛出
 * `Error(JSON.payload.error ?? HTTP status)`，并附带 `status` / `payload`。
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && init.body !== null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const res = await fetch(url, { ...init, headers, cache: 'no-store' });

  const raw = await res.text();
  let payload: unknown = null;
  if (raw.trim() !== '') {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      payload = raw;
    }
  }

  if (!res.ok) {
    const error = new Error(
      isApiError(payload) ? payload.error : String(res.status),
    ) as ApiRequestError;
    error.status = res.status;
    error.payload = isApiError(payload) ? payload : null;
    throw error;
  }

  return payload as T;
}

function repoPath(fullName: string): string {
  const [owner, name] = fullName.split('/');
  if (!owner || !name) throw new Error('invalid_repo_full_name');
  return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

export const api = {
  health(): Promise<HealthPayload> {
    return fetchJson<HealthPayload>('/api/health');
  },

  repos(): Promise<{ repos: RepoSummary[] }> {
    return fetchJson<{ repos: RepoSummary[] }>('/api/repos');
  },

  addRepo(fullName: string): Promise<{ repo: RepoSummary; mode: DataMode }> {
    return fetchJson<{ repo: RepoSummary; mode: DataMode }>('/api/repos', {
      method: 'POST',
      body: JSON.stringify({ fullName }),
    });
  },

  toggleRepo(id: number, enabled: boolean): Promise<{ repo: RepoSummary }> {
    return fetchJson<{ repo: RepoSummary }>(`/api/repos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  },

  deleteRepo(id: number): Promise<{ ok: true }> {
    return fetchJson<{ ok: true }>(`/api/repos/${id}`, { method: 'DELETE' });
  },

  sync(fullName?: string): Promise<{ runs: SyncRunRow[]; mode: DataMode }> {
    return fetchJson<{ runs: SyncRunRow[]; mode: DataMode }>('/api/sync', {
      method: 'POST',
      body: JSON.stringify(fullName ? { fullName } : {}),
    });
  },

  syncRuns(limit = 20): Promise<{ runs: SyncRunRow[]; mode: DataMode }> {
    const params = new URLSearchParams({ limit: String(limit) });
    return fetchJson<{ runs: SyncRunRow[]; mode: DataMode }>(`/api/sync?${params.toString()}`);
  },

  metrics(fullName: string, days = 30): Promise<{ data: RepoMetrics }> {
    const params = new URLSearchParams({ days: String(days) });
    return fetchJson<{ data: RepoMetrics }>(
      `/api/metrics/${repoPath(fullName)}?${params.toString()}`,
    );
  },

  aggregate(days = 30, repos?: string[]): Promise<{ data: AggregateMetrics }> {
    const params = new URLSearchParams({ days: String(days) });
    if (repos && repos.length > 0) params.set('repos', repos.join(','));
    return fetchJson<{ data: AggregateMetrics }>(`/api/aggregate?${params.toString()}`);
  },
};

import { execSync } from 'node:child_process';

import { getConfig } from '../config';
import { getStoredToken } from '../settings-store';
import { GithubApiError, type RateLimitInfo, type TokenResolution } from './types';

const API_BASE = 'https://api.github.com';
const GRAPHQL_PATH = '/graphql';

const USER_AGENT = 'github-insights-agg/1.0';
const ACCEPT = 'application/vnd.github+json';
const API_VERSION = '2022-11-28';

/** 5xx / 网络错误退避：共 3 次重试。 */
const SERVER_BACKOFF_MS = [500, 1500, 4000];
const MAX_SERVER_RETRIES = SERVER_BACKOFF_MS.length;
/** 配额耗尽时最多等待 5s，超过直接抛错交给上层标记 partial。 */
const MAX_RATE_LIMIT_WAIT_MS = 5_000;
const MAX_RATE_LIMIT_WAITS = 2;
const TOKEN_COMMAND_TIMEOUT_MS = 5_000;
/** 单次 Token 校验（GET /user）的超时。 */
const VALIDATE_TIMEOUT_MS = 10_000;

let ghCliAttempted = false;
let ghCliToken: string | null = null;

let lastRequestAt = 0;
let throttleChain: Promise<void> = Promise.resolve();
let rateLimitInfo: RateLimitInfo | null = null;

/* ------------------------------------------------------------------ */
/* Token                                                               */
/* ------------------------------------------------------------------ */

/**
 * Token 解析顺序：GITHUB_TOKEN / GH_TOKEN -> 应用内保存的 Token（SQLite） -> `gh auth token`。
 * `gh auth token` 的结果（含失败）缓存到模块级变量，失败后不再重试；
 * 应用内保存的 Token 每次现读，设置后立即生效。
 */
export function resolveToken(): TokenResolution {
  const fromEnv =
    (process.env.GITHUB_TOKEN ?? '').trim() || (process.env.GH_TOKEN ?? '').trim();
  if (fromEnv) return { token: fromEnv, source: 'env' };

  const fromStore = readStoredToken();
  if (fromStore) return { token: fromStore, source: 'stored' };

  if (!ghCliAttempted) {
    ghCliAttempted = true;
    try {
      const stdout = execSync('gh auth token', {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
        timeout: TOKEN_COMMAND_TIMEOUT_MS,
      });
      const trimmed = String(stdout ?? '').trim();
      ghCliToken = trimmed.length > 0 ? trimmed : null;
    } catch {
      ghCliToken = null;
    }
  }

  return ghCliToken ? { token: ghCliToken, source: 'gh-cli' } : { token: null, source: 'none' };
}

/**
 * 读取应用内保存的 Token。
 * 数据库尚未建表 / 打开失败时吞掉错误并跳过该来源，绝不让 `resolveToken()` 崩溃。
 */
function readStoredToken(): string | null {
  try {
    const stored = getStoredToken();
    const token = stored ? stored.token.trim() : '';
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * 清空模块级缓存（配额信息 + `gh auth token` 结果）。
 * 设置/清除 Token 后调用，避免回退链继续使用旧的 CLI 结果。
 */
export function resetTokenCaches(): void {
  ghCliAttempted = false;
  ghCliToken = null;
  rateLimitInfo = null;
}

/** 最近一次响应观测到的配额信息（未发过请求时为 null）。 */
export function getRateLimitInfo(): RateLimitInfo | null {
  return rateLimitInfo;
}

export interface TokenValidationResult {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  /** 来自 `x-oauth-scopes`（逗号分隔，可能为空），已拆分并 trim。 */
  scopes: string[];
  rateLimit: RateLimitInfo | null;
}

/**
 * 用**传入的候选 Token**（而不是 `resolveToken()` 的结果）调 `GET /user` 验证。
 *
 * - 成功 -> 返回账号信息 + scopes + 配额；
 * - 401 -> 返回 null（Token 无效 / 已撤销）；
 * - 其他非 2xx -> 抛 `GithubApiError`；网络错误 -> 抛 `GithubApiError(0)`。
 *
 * 不做重试、不写模块级配额缓存，避免把「一次验证」的配额当成全局状态。
 * 返回的错误信息中绝不包含 Token 明文。
 */
export async function validateToken(token: string): Promise<TokenValidationResult | null> {
  const candidate = (token ?? '').trim();
  if (!candidate) return null;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/user`, {
      method: 'GET',
      headers: {
        Accept: ACCEPT,
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': USER_AGENT,
        Authorization: `Bearer ${candidate}`,
      },
      signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    throw new GithubApiError(0, '/user', `network error: ${errorMessageOf(error)}`);
  }

  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }

  if (response.status === 401) return null;

  if (response.status < 200 || response.status >= 300) {
    throw new GithubApiError(
      response.status,
      '/user',
      extractBodyMessage(body) ?? `token validation failed with status ${response.status}`,
    );
  }

  let parsed: unknown = null;
  if (body.trim() !== '') {
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new GithubApiError(response.status, '/user', 'invalid JSON in GitHub response');
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new GithubApiError(response.status, '/user', 'unexpected /user response shape');
  }

  const user = parsed as { login?: unknown; name?: unknown; avatar_url?: unknown };
  const login = typeof user.login === 'string' ? user.login : '';
  if (!login) {
    throw new GithubApiError(response.status, '/user', 'GitHub /user response has no login');
  }

  return {
    login,
    name: typeof user.name === 'string' && user.name.trim() !== '' ? user.name : null,
    avatarUrl:
      typeof user.avatar_url === 'string' && user.avatar_url.trim() !== '' ? user.avatar_url : null,
    scopes: parseScopes(response.headers.get('x-oauth-scopes')),
    rateLimit: parseRateLimit(response.headers),
  };
}

/* ------------------------------------------------------------------ */
/* 内部工具                                                            */
/* ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 串行化节流：保证相邻两次请求至少间隔 minIntervalMs。 */
function throttle(): Promise<void> {
  const next = throttleChain.then(async () => {
    const interval = getConfig().minIntervalMs;
    const wait = lastRequestAt + interval - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  });
  throttleChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function buildHeaders(hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: ACCEPT,
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': USER_AGENT,
  };
  if (hasBody) headers['Content-Type'] = 'application/json';
  const token = resolveToken().token;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** 手写 query 序列化（不用 URL 对象，避免 searchParams 被丢弃）。 */
function serializeQuery(params?: Record<string, string | number>): string {
  if (!params) return '';
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

/** 从响应头解析配额信息（纯函数，不写模块级缓存）。 */
function parseRateLimit(headers: Headers): RateLimitInfo | null {
  const remainingRaw = headers.get('x-ratelimit-remaining');
  const limitRaw = headers.get('x-ratelimit-limit');
  const resetRaw = headers.get('x-ratelimit-reset');
  if (remainingRaw === null || limitRaw === null || resetRaw === null) return null;
  const remaining = Number(remainingRaw);
  const limit = Number(limitRaw);
  const reset = Number(resetRaw);
  if (!Number.isFinite(remaining) || !Number.isFinite(limit) || !Number.isFinite(reset)) return null;
  return {
    remaining,
    limit,
    resetAt: new Date(reset * 1000).toISOString(),
  };
}

function readRateLimit(headers: Headers): void {
  const parsed = parseRateLimit(headers);
  if (parsed) rateLimitInfo = parsed;
}

/** `x-oauth-scopes`：逗号分隔，可能为空。 */
function parseScopes(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) return `${error.message} (${cause.message})`;
    return error.message;
  }
  return String(error);
}

function extractBodyMessage(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const message = record.message;
      if (typeof message === 'string' && message.trim()) return message.trim();
      const errors = record.errors;
      if (Array.isArray(errors)) {
        const joined = errors
          .map((item) =>
            item && typeof item === 'object' && typeof (item as { message?: unknown }).message === 'string'
              ? String((item as { message: string }).message)
              : null,
          )
          .filter((item): item is string => item !== null)
          .join('; ');
        if (joined) return joined;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** 读取 rate-limit reset 头，返回还需等待的毫秒数。 */
function rateLimitWaitMs(headers: Headers): number {
  const resetRaw = headers.get('x-ratelimit-reset');
  if (resetRaw === null) return 0;
  const reset = Number(resetRaw);
  if (!Number.isFinite(reset)) return 0;
  return Math.max(0, reset * 1000 - Date.now());
}

interface RawRequest {
  method: 'GET' | 'POST';
  /** 用于错误信息里的可读路径（含 query） */
  path: string;
  url: string;
  body?: string;
}

interface RawResponse {
  status: number;
  body: string;
}

/**
 * 底层请求：节流 + 限流等待 + 5xx/网络指数退避。
 * 只负责拿到响应，状态码语义由调用方解释。
 */
async function requestRaw(req: RawRequest): Promise<RawResponse> {
  let serverRetries = 0;
  let rateLimitWaits = 0;

  for (;;) {
    await throttle();

    let response: Response;
    try {
      response = await fetch(req.url, {
        method: req.method,
        headers: buildHeaders(req.body !== undefined),
        body: req.body,
      });
    } catch (error) {
      if (serverRetries < MAX_SERVER_RETRIES) {
        const delay = SERVER_BACKOFF_MS[serverRetries] ?? 4000;
        serverRetries += 1;
        await sleep(delay);
        continue;
      }
      throw new GithubApiError(0, req.path, `network error: ${errorMessageOf(error)}`);
    }

    readRateLimit(response.headers);

    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      if (serverRetries < MAX_SERVER_RETRIES) {
        const delay = SERVER_BACKOFF_MS[serverRetries] ?? 4000;
        serverRetries += 1;
        await sleep(delay);
        continue;
      }
      throw new GithubApiError(
        response.status,
        req.path,
        `failed to read response body: ${errorMessageOf(error)}`,
      );
    }

    const status = response.status;
    const remaining = response.headers.get('x-ratelimit-remaining');

    if ((status === 403 || status === 429) && remaining === '0') {
      const waitMs = rateLimitWaitMs(response.headers);
      if (rateLimitWaits >= MAX_RATE_LIMIT_WAITS || waitMs > MAX_RATE_LIMIT_WAIT_MS) {
        throw new GithubApiError(
          status,
          req.path,
          `API rate limit exhausted (remaining=0, resets at ${rateLimitInfo?.resetAt ?? 'unknown'})`,
        );
      }
      rateLimitWaits += 1;
      await sleep(waitMs + 100);
      continue;
    }

    if (status >= 500) {
      if (serverRetries < MAX_SERVER_RETRIES) {
        const delay = SERVER_BACKOFF_MS[serverRetries] ?? 4000;
        serverRetries += 1;
        await sleep(delay);
        continue;
      }
      throw new GithubApiError(
        status,
        req.path,
        extractBodyMessage(body) ?? `GitHub server error (${status})`,
      );
    }

    return { status, body };
  }
}

/* ------------------------------------------------------------------ */
/* REST                                                                */
/* ------------------------------------------------------------------ */

export interface RestOptions {
  params?: Record<string, string | number>;
  allow404?: boolean;
  allow202?: boolean;
}

/**
 * REST v3 调用。
 * - 404 且 allow404 -> null
 * - 202 且 allow202 -> null（stats 未就绪）
 * - 其余非 2xx -> 抛 GithubApiError
 */
export async function rest<T>(path: string, opts: RestOptions = {}): Promise<T | null> {
  const query = serializeQuery(opts.params);
  const url = `${API_BASE}${path}${query}`;
  const { status, body } = await requestRaw({ method: 'GET', path: `${path}${query}`, url });

  if (status === 404) {
    if (opts.allow404) return null;
    throw new GithubApiError(404, path, extractBodyMessage(body) ?? 'resource not found');
  }

  if (status === 202) {
    if (opts.allow202) return null;
    throw new GithubApiError(202, path, 'GitHub is still computing this resource (202)');
  }

  if (status === 204) return null;

  if (status < 200 || status >= 300) {
    throw new GithubApiError(
      status,
      path,
      extractBodyMessage(body) ?? `unexpected GitHub response status ${status}`,
    );
  }

  if (body.trim() === '') return null;

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new GithubApiError(status, path, 'invalid JSON in GitHub response');
  }
}

/* ------------------------------------------------------------------ */
/* GraphQL                                                             */
/* ------------------------------------------------------------------ */

export async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const payload = JSON.stringify({ query, variables });
  const { status, body } = await requestRaw({
    method: 'POST',
    path: GRAPHQL_PATH,
    url: `${API_BASE}${GRAPHQL_PATH}`,
    body: payload,
  });

  if (status < 200 || status >= 300) {
    throw new GithubApiError(
      status,
      GRAPHQL_PATH,
      extractBodyMessage(body) ?? `GraphQL request failed with status ${status}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new GithubApiError(status, GRAPHQL_PATH, 'invalid JSON in GraphQL response');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new GithubApiError(status, GRAPHQL_PATH, 'unexpected GraphQL response shape');
  }

  const record = parsed as { data?: unknown; errors?: unknown };
  if (Array.isArray(record.errors) && record.errors.length > 0) {
    const message =
      record.errors
        .map((item) =>
          item && typeof item === 'object' && typeof (item as { message?: unknown }).message === 'string'
            ? String((item as { message: string }).message)
            : null,
        )
        .filter((item): item is string => item !== null)
        .join('; ') || 'GraphQL returned errors';
    throw new GithubApiError(status, GRAPHQL_PATH, message);
  }

  if (record.data === undefined || record.data === null) {
    throw new GithubApiError(status, GRAPHQL_PATH, 'GraphQL response has no data');
  }

  return record.data as T;
}

/* ------------------------------------------------------------------ */
/* 错误文案                                                            */
/* ------------------------------------------------------------------ */

export function githubErrorMessage(err: unknown): string {
  if (err instanceof GithubApiError) {
    const where = err.status > 0 ? `${err.status} ${err.path}` : err.path;
    return where ? `${where}: ${err.message}` : err.message;
  }
  return errorMessageOf(err);
}

/**
 * GitHub OAuth Device Flow（应用内「一键授权获取 Token」）。
 *
 * 与 `client.ts` 的区别：这里请求的是 `github.com`（OAuth 端点）而不是 `api.github.com`，
 * 因此**不复用** `rest()`（它的 base URL / 鉴权头 / 限流语义都不适用），
 * 用独立 `fetch`，15s 超时，不携带任何 GitHub Token。
 *
 * 只需要 OAuth App 的 Client ID（`GITHUB_OAUTH_CLIENT_ID`），不需要 Client Secret。
 */

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = 'github-insights-agg/1.0';
const ACCEPT = 'application/json';

/** Device Flow 申请的权限：`repo` 读私有库/traffic，`read:org` 读组织信息。 */
export const DEVICE_FLOW_SCOPES = 'repo read:org';

/** GitHub Device Flow 默认轮询间隔（秒），`slow_down` 时在此基础上加 5。 */
const DEFAULT_INTERVAL_SECONDS = 5;

/** `slow_down` 的间隔上限（秒）：按 RFC 8628 每次 +5，但不超过 60 秒。 */
const MAX_INTERVAL_SECONDS = 60;

/** `slow_down` 每次递增的秒数。 */
const SLOW_DOWN_STEP_SECONDS = 5;

/** Device Flow 相关错误（`code` 便于上层区分降级路径）。 */
export class GithubOAuthError extends Error {
  readonly code: string;
  readonly description: string;
  readonly status: number;

  constructor(code: string, description: string, status = 0) {
    super(description ? `${code}: ${description}` : code);
    this.name = 'GithubOAuthError';
    this.code = code;
    this.description = description;
    this.status = status;
  }
}

/** `GITHUB_OAUTH_CLIENT_ID` 配置值；未配置返回 null。 */
export function getOAuthClientId(): string | null {
  const raw = (process.env.GITHUB_OAUTH_CLIENT_ID ?? '').trim();
  return raw.length > 0 ? raw : null;
}

/** 是否可用应用内一键授权（仅取决于是否配置了 Client ID）。 */
export function deviceFlowAvailable(): boolean {
  return getOAuthClientId() !== null;
}

export interface DeviceCodeResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type PollResult =
  | { state: 'pending' }
  | { state: 'slow_down'; interval: number }
  | { state: 'success'; token: string; scope: string }
  | { state: 'error'; error: string; description: string };

interface OAuthPayload {
  [key: string]: unknown;
}

interface OAuthResponse {
  status: number;
  payload: OAuthPayload;
  raw: string;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * POST 表单到 OAuth 端点，解析 JSON。
 * 非 2xx 也算「拿到结构化响应」：交给调用方按 `error` 字段解释。
 */
async function postForm(url: string, form: Record<string, string>): Promise<OAuthResponse> {
  const body = new URLSearchParams(form).toString();

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: ACCEPT,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GithubOAuthError('oauth_network_error', `${url}: ${message}`);
  }

  let raw = '';
  try {
    raw = await response.text();
  } catch {
    raw = '';
  }

  let payload: OAuthPayload = {};
  if (raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') payload = parsed as OAuthPayload;
    } catch {
      // 非 JSON（理论上不会出现）：保留 raw 供上层拼错误信息
    }
  }

  return { status: response.status, payload, raw };
}

/**
 * 把 GitHub 的 OAuth 错误码/非标准响应体归一成前端可直接展示的中文说明。
 *
 * GitHub 对未注册的 client_id 会返回 HTTP 404 + `{"error":"Not Found"}`（不是标准
 * OAuth 错误体），若原样透传，用户会在界面上看到一串英文 JSON。这里统一兜住。
 */
function normalizeOAuthError(
  code: string,
  description: string,
  status: number,
): { code: string; description: string } {
  switch (code) {
    case 'device_flow_unavailable':
      return { code, description: '尚未配置 GITHUB_OAUTH_CLIENT_ID，无法使用一键授权。' };
    case 'incorrect_client_credentials':
    case 'invalid_client':
      return { code, description: 'Client ID 无效，请检查 GITHUB_OAUTH_CLIENT_ID 是否填写正确。' };
    case 'device_flow_disabled':
      return {
        code,
        description: '该 OAuth App 未启用 Device Flow，请在 GitHub 上勾选 Enable Device Flow 后重试。',
      };
    case 'expired_token':
      return { code, description: '验证码已过期，请重新生成。' };
    case 'access_denied':
      return { code, description: '你取消了本次授权。' };
    case 'unsupported_grant_type':
      return { code, description: 'OAuth 授权类型不被支持，请检查 OAuth App 配置。' };
    case 'authorization_pending':
      return { code, description: '等待你在浏览器中完成授权。' };
    case 'slow_down':
      return { code, description: '请求过于频繁，已自动降低轮询频率。' };
  }

  // 非标准错误体（例如 404 Not Found）：给出可操作的排查提示，不暴露原始 JSON。
  if (status === 404) {
    return {
      code: 'device_flow_http_error',
      description:
        'GitHub 未识别该 Client ID（HTTP 404）。请确认 GITHUB_OAUTH_CLIENT_ID 无误，且对应 OAuth App 已勾选 Enable Device Flow。',
    };
  }
  if (status >= 500) {
    return {
      code: 'device_flow_http_error',
      description: `GitHub 服务暂时不可用（HTTP ${status}），请稍后重试。`,
    };
  }
  const trimmed = description.trim();
  return {
    code: 'device_flow_http_error',
    description: trimmed
      ? `GitHub 返回错误（HTTP ${status}）：${trimmed.slice(0, 160)}`
      : `GitHub 返回错误（HTTP ${status}），请检查 OAuth App 配置。`,
  };
}

/**
 * 发起 Device Flow，拿到 user_code 与 verification_uri。
 * 未配置 Client ID 时抛 `device_flow_unavailable`。
 */
export async function startDeviceFlow(): Promise<DeviceCodeResult> {
  const clientId = getOAuthClientId();
  if (!clientId) {
    throw new GithubOAuthError(
      'device_flow_unavailable',
      '尚未配置 GITHUB_OAUTH_CLIENT_ID，无法使用一键授权。',
    );
  }

  const { status, payload, raw } = await postForm(DEVICE_CODE_URL, {
    client_id: clientId,
    scope: DEVICE_FLOW_SCOPES,
  });

  const error = asString(payload.error);
  if (error) {
    const normalized = normalizeOAuthError(
      error,
      asString(payload.error_description) || raw.slice(0, 300),
      status,
    );
    throw new GithubOAuthError(normalized.code, normalized.description, status);
  }

  const deviceCode = asString(payload.device_code);
  const userCode = asString(payload.user_code);
  const verificationUri = asString(payload.verification_uri);
  if (status < 200 || status >= 300 || !deviceCode || !userCode || !verificationUri) {
    throw new GithubOAuthError(
      'device_flow_bad_response',
      raw.slice(0, 300) || `unexpected status ${status}`,
      status,
    );
  }

  return {
    deviceCode,
    userCode,
    verificationUri,
    expiresIn: asNumber(payload.expires_in, 900),
    interval: asNumber(payload.interval, DEFAULT_INTERVAL_SECONDS),
  };
}

/**
 * 计算 `slow_down` 之后的新轮询间隔。
 *
 * 该函数是纯函数，因为本模块无状态：GitHub 的 `slow_down` 响应体通常**不含** `interval`，
 * 只有把「调用方当前的间隔」传进来，才能按规范递增（10 → 15 → 20 …）。
 *
 * 规则：`currentInterval + 5`；若响应体自带更大的 `interval` 则取两者最大值；
 * 结果统一收敛到 1~60 秒。
 */
function nextSlowDownInterval(currentInterval: number | undefined, payloadInterval: unknown): number {
  const base =
    typeof currentInterval === 'number' && Number.isFinite(currentInterval)
      ? currentInterval
      : DEFAULT_INTERVAL_SECONDS;
  let next = Math.floor(base) + SLOW_DOWN_STEP_SECONDS;

  const fromPayload = asNumber(payloadInterval, 0);
  if (fromPayload > next) next = fromPayload;

  return Math.min(MAX_INTERVAL_SECONDS, Math.max(1, next));
}

/**
 * 轮询一次 Device Flow 状态。
 *
 * GitHub 语义：
 * - `authorization_pending` -> 继续按 interval 轮询；
 * - `slow_down` -> interval + 5 秒（上限 60 秒，需要调用方把当前间隔传进来才能累积）；
 * - `expired_token` / `access_denied` / 其他 -> error。
 *
 * @param currentInterval 调用方当前使用的轮询间隔（秒，可选）；仅在 `slow_down` 时参与计算。
 */
export async function pollDeviceFlow(
  deviceCode: string,
  currentInterval?: number,
): Promise<PollResult> {
  const clientId = getOAuthClientId();
  if (!clientId) {
    return {
      state: 'error',
      error: 'device_flow_unavailable',
      description: '尚未配置 GITHUB_OAUTH_CLIENT_ID，无法使用一键授权。',
    };
  }

  const code = (deviceCode ?? '').trim();
  if (!code) {
    return { state: 'error', error: 'invalid_device_code', description: 'device_code is empty' };
  }

  const { status, payload, raw } = await postForm(ACCESS_TOKEN_URL, {
    client_id: clientId,
    device_code: code,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });

  const error = asString(payload.error);
  if (error === 'authorization_pending') return { state: 'pending' };
  if (error === 'slow_down') {
    return { state: 'slow_down', interval: nextSlowDownInterval(currentInterval, payload.interval) };
  }
  if (error) {
    const normalized = normalizeOAuthError(
      error,
      asString(payload.error_description) || raw.slice(0, 300),
      status,
    );
    return {
      state: 'error',
      error: normalized.code,
      description: normalized.description,
    };
  }

  const token = asString(payload.access_token);
  if (!token) {
    return {
      state: 'error',
      error: 'device_flow_bad_response',
      description: raw.slice(0, 300) || `unexpected status ${status}`,
    };
  }

  return { state: 'success', token, scope: asString(payload.scope) };
}

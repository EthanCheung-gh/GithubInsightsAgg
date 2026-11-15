import { NextResponse, type NextRequest } from 'next/server';

import {
  deviceFlowAvailable,
  GithubOAuthError,
  pollDeviceFlow,
  resetTokenCaches,
  startDeviceFlow,
  validateToken,
} from '@/lib/github';
import { maskToken, setStoredToken } from '@/lib/settings-store';
import { devicePollSchema, formatZodError } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEVICE_FLOW_UNAVAILABLE_DETAIL =
  '如需启用一键授权，请配置 GITHUB_OAUTH_CLIENT_ID（只需 Client ID）';

function internalError(error: unknown): NextResponse {
  return NextResponse.json(
    { error: 'internal_error', detail: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  );
}

/** OAuth 层错误透传：有 4xx/5xx 就用 GitHub 原始状态码，否则按 502（上游不可用）处理。 */
function oauthError(error: GithubOAuthError): NextResponse {
  const status = error.status >= 400 && error.status < 600 ? error.status : 502;
  return NextResponse.json(
    { error: error.code || 'device_flow_failed', detail: error.description },
    { status },
  );
}

/**
 * 发起 Device Flow，返回 `user_code` 与授权链接。
 *
 * - 未配置 `GITHUB_OAUTH_CLIENT_ID` → 501 `device_flow_unavailable`
 * - GitHub 侧报错（如 client_id 未注册）→ 透传其状态码与 `error` / `error_description`
 */
export async function POST(): Promise<NextResponse> {
  try {
    if (!deviceFlowAvailable()) {
      return NextResponse.json(
        { error: 'device_flow_unavailable', detail: DEVICE_FLOW_UNAVAILABLE_DETAIL },
        { status: 501 },
      );
    }

    const result = await startDeviceFlow();
    return NextResponse.json({
      deviceCode: result.deviceCode,
      userCode: result.userCode,
      verificationUri: result.verificationUri,
      expiresIn: result.expiresIn,
      interval: result.interval,
    });
  } catch (error) {
    if (error instanceof GithubOAuthError) return oauthError(error);
    return internalError(error);
  }
}

/**
 * 轮询一次 Device Flow 状态（前端按 `state` 分发）。
 *
 * 轮询语义一律用 HTTP 200 表达，避免前端把「还在等用户点授权」当成网络错误：
 * - `pending` / `slow_down` / `error` 直接透传；
 * - `success` 先 `validateToken()` 再落库，响应里只有脱敏 Token。
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = devicePollSchema.safeParse({ deviceCode: searchParams.get('deviceCode') });
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_body', detail: formatZodError(parsed.error) },
        { status: 400 },
      );
    }

    const result = await pollDeviceFlow(parsed.data.deviceCode);
    if (result.state !== 'success') return NextResponse.json(result);

    const token = result.token.trim();
    let login = '';
    let scopes: string[] = [];
    try {
      const validation = await validateToken(token);
      if (!validation) {
        return NextResponse.json({
          state: 'error',
          error: 'invalid_token',
          description: 'Token 无效或已过期，请确认已勾选 repo 权限',
        });
      }
      login = validation.login;
      scopes = validation.scopes;
    } catch (error) {
      return NextResponse.json({
        state: 'error',
        error: 'invalid_token',
        description: `Token 校验失败：${error instanceof Error ? error.message : String(error)}`,
      });
    }

    setStoredToken(token);
    resetTokenCaches();

    return NextResponse.json({
      state: 'success',
      login,
      scopes,
      maskedToken: maskToken(token),
      source: 'stored',
    });
  } catch (error) {
    return internalError(error);
  }
}

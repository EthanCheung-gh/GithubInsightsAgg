import { NextResponse, type NextRequest } from 'next/server';

import {
  deviceFlowAvailable,
  resetTokenCaches,
  resolveToken,
  validateToken,
} from '@/lib/github';
import type { TokenSource } from '@/lib/github';
import { clearStoredToken, maskToken, setStoredToken } from '@/lib/settings-store';
import { formatZodError, tokenSetSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Token 相关的固定外链（前端直接渲染，不在客户端拼接）。 */
const SETTING_URL = 'https://github.com/settings/tokens';
const CREATE_TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=repo,read:org&description=GithubInsightsAgg';

/** Token 来源的中文标签，键与 `TokenSource` 一一对应。 */
const SOURCE_LABELS: Record<TokenSource, string> = {
  env: '环境变量',
  stored: '应用内保存',
  'gh-cli': 'gh CLI',
  none: '未配置',
};

const INVALID_TOKEN_DETAIL = 'Token 无效或已过期，请确认已勾选 repo 权限';

function internalError(error: unknown): NextResponse {
  return NextResponse.json(
    { error: 'internal_error', detail: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  );
}

/** 读取原始 JSON body；非法 JSON / 空 body 一律折叠成 `null` 交给 zod 报错。 */
async function readJsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * 当前 Token 状态（只读）。
 *
 * **不发起任何 GitHub 请求**：`resolveToken()` 只读 env / SQLite / 本地 `gh auth token`。
 * 响应里只出现脱敏后的 Token，绝不返回明文。
 */
export async function GET(): Promise<NextResponse> {
  try {
    const resolution = resolveToken();
    const hasToken = resolution.token !== null;

    return NextResponse.json({
      configured: hasToken,
      source: resolution.source,
      sourceLabel: SOURCE_LABELS[resolution.source],
      maskedToken: resolution.token ? maskToken(resolution.token) : null,
      canClear: resolution.source === 'stored',
      deviceFlowAvailable: deviceFlowAvailable(),
      settingUrl: SETTING_URL,
      createTokenUrl: CREATE_TOKEN_URL,
    });
  } catch (error) {
    return internalError(error);
  }
}

/**
 * 粘贴 Token：先 schema 校验，再打 GitHub `GET /user` 验证，通过后落库并清空缓存。
 *
 * 失败分支：
 * - schema 不通过 → 400 `invalid_token`
 * - `validateToken()` 返回 null（401）→ 400 `invalid_token`
 * - 其他异常（网络 / 5xx）→ 500 `internal_error`
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const parsed = tokenSetSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_token', detail: formatZodError(parsed.error) },
        { status: 400 },
      );
    }

    // schema 已 trim，这里再 trim 一次只是让「传给 GitHub 的值」显式可控
    const token = parsed.data.token.trim();

    const validation = await validateToken(token);
    if (!validation) {
      return NextResponse.json(
        { error: 'invalid_token', detail: INVALID_TOKEN_DETAIL },
        { status: 400 },
      );
    }

    setStoredToken(token);
    resetTokenCaches();

    return NextResponse.json({
      ok: true,
      login: validation.login,
      scopes: validation.scopes,
      maskedToken: maskToken(token),
      source: 'stored',
    });
  } catch (error) {
    return internalError(error);
  }
}

/**
 * 清除应用内保存的 Token。
 *
 * - Token 来自环境变量 → 409 `token_from_env`（改 env 后重启才生效）
 * - 没有应用内 Token → 404 `no_stored_token`
 * - 成功 → 200 `{ ok: true }`
 */
export async function DELETE(): Promise<NextResponse> {
  try {
    const resolution = resolveToken();
    if (resolution.source === 'env') {
      return NextResponse.json(
        {
          error: 'token_from_env',
          detail: '当前 Token 来自环境变量，请修改 GITHUB_TOKEN 或 GH_TOKEN 后重启',
        },
        { status: 409 },
      );
    }

    if (!clearStoredToken()) {
      return NextResponse.json({ error: 'no_stored_token' }, { status: 404 });
    }

    resetTokenCaches();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return internalError(error);
  }
}

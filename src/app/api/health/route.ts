import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { dbPath } from '@/lib/db';
import { getRateLimitInfo, resolveToken } from '@/lib/github';
import { countRepos, lastSyncedAt } from '@/lib/repo-store';
import type { HealthPayload } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 健康检查 / 配置诊断。
 * 刻意**不调用** `ensureBootstrapped()`：健康探针不应写库。
 */
export async function GET(): Promise<NextResponse> {
  try {
    const resolution = resolveToken();
    const tokenConfigured = resolution.token !== null;
    const counts = countRepos();
    const payload: HealthPayload = {
      ok: true,
      version: getConfig().version,
      mode: tokenConfigured ? 'live' : 'demo',
      tokenConfigured,
      // 契约 §5 的 'env' 语义是「成功解析到 Token」（增补 A4），细节见 tokenSourceDetail
      tokenSource: tokenConfigured ? 'env' : 'none',
      tokenSourceDetail: resolution.source,
      repoCount: counts.total,
      enabledRepoCount: counts.enabled,
      lastSyncAt: lastSyncedAt(),
      dbPath: dbPath(),
      rateLimit: getRateLimitInfo(),
    };
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'health_check_failed',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

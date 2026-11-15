import { NextResponse, type NextRequest } from 'next/server';

import { ensureBootstrapped } from '@/lib/bootstrap';
import {
  deleteRepo,
  getRepoByFullName,
  insertRepo,
  listRepos,
  normalizeFullName,
} from '@/lib/repo-store';
import { syncRepo, effectiveMode } from '@/lib/sync';
import type { DataMode } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function internalError(error: unknown): NextResponse {
  return NextResponse.json(
    { error: 'internal_error', detail: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  );
}

/** 接受 `{ fullName }` 或 `{ owner, name }`，返回规范化全名或 null。 */
function parseAddRepoBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (typeof record.fullName === 'string') return normalizeFullName(record.fullName);
  if (typeof record.owner === 'string' && typeof record.name === 'string') {
    return normalizeFullName(`${record.owner.trim()}/${record.name.trim()}`);
  }
  return null;
}

/** syncRepo 的返回值结构由 WP2 定义，这里做无类型假设的宽松读取。 */
function readSyncOutcome(result: unknown): { status: string | null; error: string | null } {
  if (!result || typeof result !== 'object') return { status: null, error: null };
  const record = result as Record<string, unknown>;
  return {
    status: typeof record.status === 'string' ? record.status : null,
    error: typeof record.error === 'string' ? record.error : null,
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    ensureBootstrapped();
    return NextResponse.json({ repos: listRepos({ sort: 'stars' }) });
  } catch (error) {
    return internalError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    ensureBootstrapped();

    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    const fullName = parseAddRepoBody(body);
    if (!fullName) {
      return NextResponse.json({ error: 'invalid_full_name' }, { status: 400 });
    }
    if (getRepoByFullName(fullName)) {
      return NextResponse.json({ error: 'repo_exists' }, { status: 409 });
    }

    const [owner, name] = fullName.split('/');
    // 先建占位行，保证 collectors 失败时也能看到仓库与同步错误
    const placeholder = insertRepo({ owner, name });
    const mode: DataMode = effectiveMode();

    let syncError: string | null = null;
    try {
      const outcome = readSyncOutcome(await syncRepo(placeholder, { days: 30, trigger: 'api' }));
      if (outcome.status === 'error') syncError = outcome.error ?? 'sync_failed';
      else if (outcome.error) syncError = outcome.error;
    } catch (error) {
      syncError = error instanceof Error ? error.message : String(error);
    }

    if (syncError && syncError.includes('not_found')) {
      deleteRepo(placeholder.id);
      return NextResponse.json({ error: 'repo_not_found' }, { status: 400 });
    }

    const repo = getRepoByFullName(fullName) ?? placeholder;
    return NextResponse.json({ repo, mode }, { status: 201 });
  } catch (error) {
    return internalError(error);
  }
}

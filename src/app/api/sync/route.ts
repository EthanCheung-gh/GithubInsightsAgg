import { NextResponse, type NextRequest } from 'next/server';

import { getRepoByFullName, normalizeFullName } from '@/lib/repo-store';
import { effectiveMode, syncAll, syncRepo } from '@/lib/sync';
import { getSyncRunById, listSyncRuns } from '@/lib/sync-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_DAYS = 30;
const MIN_DAYS = 7;
const MAX_DAYS = 90;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function internalError(error: unknown): NextResponse {
  return NextResponse.json(
    {
      error: 'internal_error',
      detail: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  );
}

function parseDays(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return DEFAULT_DAYS;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  if (parsed < MIN_DAYS || parsed > MAX_DAYS) return null;
  return parsed;
}

function parseLimit(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return DEFAULT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return null;
  return Math.min(MAX_LIMIT, parsed);
}

function parseFullName(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  if (value.trim() === '') return undefined;
  return normalizeFullName(value);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 请求体可空：`POST /api/sync` 直接同步全部 enabled 仓库
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

    const days = parseDays(record.days);
    if (days === null) {
      return NextResponse.json(
        { error: 'invalid_days', detail: `days 必须是 ${MIN_DAYS}~${MAX_DAYS} 的整数` },
        { status: 400 },
      );
    }

    const fullName = parseFullName(record.fullName);
    if (fullName === null) {
      return NextResponse.json({ error: 'invalid_full_name' }, { status: 400 });
    }

    if (fullName) {
      const repo = getRepoByFullName(fullName);
      if (!repo) {
        return NextResponse.json({ error: 'repo_not_found' }, { status: 404 });
      }
      const result = await syncRepo(repo, { days, trigger: 'api' });
      const run = getSyncRunById(result.runId);
      return NextResponse.json({
        runs: run ? [run] : [],
        mode: effectiveMode(),
      });
    }

    const results = await syncAll({ days, trigger: 'api' });
    return NextResponse.json({
      // syncAll 会额外写一条 scope='all' 的汇总 run
      runs: listSyncRuns(results.length + 1),
      mode: effectiveMode(),
    });
  } catch (error) {
    return internalError(error);
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const limit = parseLimit(request.nextUrl.searchParams.get('limit'));
    if (limit === null) {
      return NextResponse.json({ error: 'invalid_limit' }, { status: 400 });
    }
    return NextResponse.json({ runs: listSyncRuns(limit), mode: effectiveMode() });
  } catch (error) {
    return internalError(error);
  }
}

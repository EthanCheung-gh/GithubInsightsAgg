import { NextResponse, type NextRequest } from 'next/server';

import { getRepoByFullName } from '@/lib/repo-store';
import { effectiveMode, syncAll, syncRepo } from '@/lib/sync';
import { getSyncRunById, listSyncRuns } from '@/lib/sync-store';
import { formatZodError, syncLimitSchema, syncRequestSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function internalError(error: unknown): NextResponse {
  return NextResponse.json(
    {
      error: 'internal_error',
      detail: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  );
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

    const parsed = syncRequestSchema.safeParse(body);
    if (!parsed.success) {
      // 与改造前一致：days 的问题优先于 fullName
      const daysInvalid = parsed.error.issues.some((issue) => issue.path[0] === 'days');
      return NextResponse.json(
        {
          error: daysInvalid ? 'invalid_days' : 'invalid_full_name',
          detail: formatZodError(parsed.error),
        },
        { status: 400 },
      );
    }

    const { fullName, days } = parsed.data;

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
    const parsed = syncLimitSchema.safeParse(request.nextUrl.searchParams.get('limit'));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_limit', detail: formatZodError(parsed.error) },
        { status: 400 },
      );
    }
    return NextResponse.json({ runs: listSyncRuns(parsed.data), mode: effectiveMode() });
  } catch (error) {
    return internalError(error);
  }
}

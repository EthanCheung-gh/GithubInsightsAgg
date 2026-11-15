import { NextResponse, type NextRequest } from 'next/server';

import { computeRepoMetrics } from '@/lib/analytics';
import { ensureBootstrapped } from '@/lib/bootstrap';
import { getRepoByFullName } from '@/lib/repo-store';
import { daysQuerySchema, formatZodError, ownerRepoSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ owner: string; repo: string }> };

function internalError(error: unknown): NextResponse {
  return NextResponse.json(
    { error: 'internal_error', detail: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  );
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    ensureBootstrapped();

    const { owner, repo } = await context.params;

    const parsedDays = daysQuerySchema.safeParse(request.nextUrl.searchParams.get('days'));
    if (!parsedDays.success) {
      return NextResponse.json(
        { error: 'invalid_days', detail: formatZodError(parsedDays.error) },
        { status: 400 },
      );
    }

    const parsedPath = ownerRepoSchema.safeParse({ owner, repo });
    if (!parsedPath.success) {
      // 路径段非法等同于「这个仓库不存在」，保持原有 404 语义
      return NextResponse.json(
        { error: 'repo_not_found', detail: formatZodError(parsedPath.error) },
        { status: 404 },
      );
    }

    const fullName = `${parsedPath.data.owner}/${parsedPath.data.repo}`;
    const summary = getRepoByFullName(fullName);
    if (!summary) {
      return NextResponse.json({ error: 'repo_not_found' }, { status: 404 });
    }

    return NextResponse.json({ data: computeRepoMetrics(summary, parsedDays.data) });
  } catch (error) {
    return internalError(error);
  }
}

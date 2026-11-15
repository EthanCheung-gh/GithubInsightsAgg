import { NextResponse, type NextRequest } from 'next/server';

import { computeRepoMetrics } from '@/lib/analytics';
import { ensureBootstrapped } from '@/lib/bootstrap';
import { getRepoByFullName, normalizeFullName } from '@/lib/repo-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_DAYS = 30;
const MIN_DAYS = 7;
const MAX_DAYS = 90;

type RouteContext = { params: Promise<{ owner: string; repo: string }> };

function internalError(error: unknown): NextResponse {
  return NextResponse.json(
    { error: 'internal_error', detail: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  );
}

function parseDays(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return DEFAULT_DAYS;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
  if (value < MIN_DAYS || value > MAX_DAYS) return null;
  return value;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    ensureBootstrapped();

    const { owner, repo } = await context.params;

    const days = parseDays(request.nextUrl.searchParams.get('days'));
    if (days === null) {
      return NextResponse.json({ error: 'invalid_days' }, { status: 400 });
    }

    const fullName = normalizeFullName(`${owner}/${repo}`);
    if (!fullName) {
      return NextResponse.json({ error: 'repo_not_found' }, { status: 404 });
    }

    const summary = getRepoByFullName(fullName);
    if (!summary) {
      return NextResponse.json({ error: 'repo_not_found' }, { status: 404 });
    }

    return NextResponse.json({ data: computeRepoMetrics(summary, days) });
  } catch (error) {
    return internalError(error);
  }
}

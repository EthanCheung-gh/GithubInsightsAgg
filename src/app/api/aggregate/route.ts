import { NextResponse, type NextRequest } from 'next/server';

import { computeAggregate } from '@/lib/analytics';
import { ensureBootstrapped } from '@/lib/bootstrap';
import { getRepoByFullName, listRepos, normalizeFullName } from '@/lib/repo-store';
import type { RepoSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_DAYS = 30;
const MIN_DAYS = 7;
const MAX_DAYS = 90;

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

/** `?repos=owner/a,owner/b`：逐项规范化，非法项与未入库项忽略。 */
function selectRepos(raw: string): RepoSummary[] {
  const selected: RepoSummary[] = [];
  const seen = new Set<string>();
  for (const item of raw.split(',')) {
    const normalized = normalizeFullName(item.trim());
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const repo = getRepoByFullName(normalized);
    if (repo) selected.push(repo);
  }
  return selected;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    ensureBootstrapped();

    const days = parseDays(request.nextUrl.searchParams.get('days'));
    if (days === null) {
      return NextResponse.json({ error: 'invalid_days' }, { status: 400 });
    }

    const rawRepos = request.nextUrl.searchParams.get('repos');
    const repos =
      rawRepos === null || rawRepos.trim() === ''
        ? listRepos({ enabledOnly: true, sort: 'stars' })
        : selectRepos(rawRepos);

    return NextResponse.json({ data: computeAggregate(repos, days) });
  } catch (error) {
    return internalError(error);
  }
}

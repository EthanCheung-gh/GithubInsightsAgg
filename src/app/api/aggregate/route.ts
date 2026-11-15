import { NextResponse, type NextRequest } from 'next/server';

import { computeAggregate } from '@/lib/analytics';
import { ensureBootstrapped } from '@/lib/bootstrap';
import { getRepoByFullName, listRepos } from '@/lib/repo-store';
import type { RepoSummary } from '@/lib/types';
import { aggregateQuerySchema, formatZodError } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function internalError(error: unknown): NextResponse {
  return NextResponse.json(
    { error: 'internal_error', detail: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  );
}

/** 已通过 schema 校验的 `owner/name` 列表：去重后映射到库内仓库，未入库项忽略。 */
function selectRepos(fullNames: string[]): RepoSummary[] {
  const selected: RepoSummary[] = [];
  const seen = new Set<string>();
  for (const fullName of fullNames) {
    const key = fullName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const repo = getRepoByFullName(fullName);
    if (repo) selected.push(repo);
  }
  return selected;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    ensureBootstrapped();

    const searchParams = request.nextUrl.searchParams;
    const parsed = aggregateQuerySchema.safeParse({
      days: searchParams.get('days'),
      repos: searchParams.get('repos'),
    });
    if (!parsed.success) {
      // 与改造前一致：days 的问题优先于 repos
      const daysInvalid = parsed.error.issues.some((issue) => issue.path[0] === 'days');
      return NextResponse.json(
        {
          error: daysInvalid ? 'invalid_days' : 'invalid_full_name',
          detail: formatZodError(parsed.error),
        },
        { status: 400 },
      );
    }

    const { days, repos: repoFullNames } = parsed.data;
    const repos =
      repoFullNames === null
        ? listRepos({ enabledOnly: true, sort: 'stars' })
        : selectRepos(repoFullNames);

    return NextResponse.json({ data: computeAggregate(repos, days) });
  } catch (error) {
    return internalError(error);
  }
}

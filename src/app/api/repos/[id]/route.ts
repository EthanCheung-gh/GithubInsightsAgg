import { NextResponse, type NextRequest } from 'next/server';

import { ensureBootstrapped } from '@/lib/bootstrap';
import { deleteRepo, getRepoById, setRepoEnabled } from '@/lib/repo-store';
import { formatZodError, repoIdSchema, repoPatchSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

function internalError(error: unknown): NextResponse {
  return NextResponse.json(
    { error: 'internal_error', detail: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  );
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    ensureBootstrapped();

    const { id } = await context.params;
    const parsedId = repoIdSchema.safeParse(id);
    if (!parsedId.success) {
      // id 不是正整数等同于「这个仓库不存在」，保持原有 404 语义
      return NextResponse.json(
        { error: 'repo_not_found', detail: formatZodError(parsedId.error) },
        { status: 404 },
      );
    }
    const repoId = parsedId.data;

    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const parsedBody = repoPatchSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'invalid_body', detail: formatZodError(parsedBody.error) },
        { status: 400 },
      );
    }
    const { enabled } = parsedBody.data;

    const existing = getRepoById(repoId);
    if (!existing) {
      return NextResponse.json({ error: 'repo_not_found' }, { status: 404 });
    }

    setRepoEnabled(repoId, enabled);
    const repo = getRepoById(repoId) ?? existing;
    return NextResponse.json({ repo });
  } catch (error) {
    return internalError(error);
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    ensureBootstrapped();

    const { id } = await context.params;
    const parsedId = repoIdSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        { error: 'repo_not_found', detail: formatZodError(parsedId.error) },
        { status: 404 },
      );
    }

    const removed = deleteRepo(parsedId.data);
    if (!removed) {
      return NextResponse.json({ error: 'repo_not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return internalError(error);
  }
}

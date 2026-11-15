import { NextResponse, type NextRequest } from 'next/server';

import { ensureBootstrapped } from '@/lib/bootstrap';
import { deleteRepo, getRepoById, setRepoEnabled } from '@/lib/repo-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

function internalError(error: unknown): NextResponse {
  return NextResponse.json(
    { error: 'internal_error', detail: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  );
}

function parseRepoId(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

function readEnabled(body: unknown): boolean | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (typeof record.enabled !== 'boolean') return null;
  return record.enabled;
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    ensureBootstrapped();

    const { id } = await context.params;
    const repoId = parseRepoId(id);
    if (repoId === null) {
      return NextResponse.json({ error: 'repo_not_found' }, { status: 404 });
    }

    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const enabled = readEnabled(body);
    if (enabled === null) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

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
    const repoId = parseRepoId(id);
    if (repoId === null) {
      return NextResponse.json({ error: 'repo_not_found' }, { status: 404 });
    }

    const removed = deleteRepo(repoId);
    if (!removed) {
      return NextResponse.json({ error: 'repo_not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return internalError(error);
  }
}

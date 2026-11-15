'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/client-api';

/**
 * 单仓的启用/停用与删除。
 * 接口成功后 `router.refresh()` 让服务端重新取数（页面是 Server Component + force-dynamic）。
 */
export function RepoActions({
  id,
  enabled,
  fullName,
}: {
  id: number;
  enabled: boolean;
  fullName: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<'toggle' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleEnabled() {
    if (pending) return;
    setPending('toggle');
    setError(null);
    try {
      await api.toggleRepo(id, !enabled);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setPending(null);
    }
  }

  async function remove() {
    if (pending) return;
    const confirmed = window.confirm(
      `确定删除 ${fullName}？该仓库的全部采集数据会一并删除，此操作不可撤销。`,
    );
    if (!confirmed) return;

    setPending('delete');
    setError(null);
    try {
      await api.deleteRepo(id);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        loading={pending === 'toggle'}
        onClick={toggleEnabled}
        title={enabled ? '停止采集该仓库' : '恢复采集该仓库'}
      >
        {pending === 'toggle' ? '处理中…' : enabled ? '停用' : '启用'}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="danger"
        loading={pending === 'delete'}
        onClick={remove}
        title="删除仓库及其采集数据"
      >
        {pending === 'delete' ? null : <Trash2 size={12} aria-hidden />}
        删除
      </Button>
      {error ? (
        <span className="max-w-[160px] truncate text-[11px] text-danger" title={error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

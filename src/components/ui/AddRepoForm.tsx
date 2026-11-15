'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { api } from '@/lib/client-api';
import { cn } from '@/lib/format';
import { Button } from './Button';

const FULL_NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function AddRepoForm({ className }: { className?: string }) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fullName = value.trim();
    if (!FULL_NAME_RE.test(fullName)) {
      setError('格式应为 owner/name');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await api.addRepo(fullName);
      setValue('');
      router.refresh();
    } catch (err) {
      const status = (err as { status?: number }).status;
      const code = err instanceof Error ? err.message : '';
      if (status === 409 || code === 'repo_exists') setError('仓库已存在');
      else if (status === 400 || code === 'repo_not_found') setError('仓库不存在或无权限');
      else setError(code || '添加失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-2">
        <input
          className="input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="owner/name"
          aria-label="仓库全名"
          spellCheck={false}
          autoComplete="off"
          disabled={loading}
        />
        <Button type="submit" variant="primary" loading={loading} className="shrink-0">
          {loading ? null : <Plus size={14} />}
          添加
        </Button>
      </div>
      {error ? <p className="text-[11px] text-danger">{error}</p> : null}
    </form>
  );
}

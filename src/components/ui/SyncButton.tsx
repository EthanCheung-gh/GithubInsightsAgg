'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { api } from '@/lib/client-api';
import { Button } from './Button';

export function SyncButton({
  fullName,
  label,
  variant = 'primary',
  size = 'sm',
}: {
  fullName?: string;
  label?: string;
  variant?: 'primary' | 'ghost';
  size?: 'sm' | 'md';
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await api.sync(fullName);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步失败');
    } finally {
      setLoading(false);
    }
  }

  const ariaLabel = label ?? (fullName ? `同步 ${fullName}` : '同步全部仓库');

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        loading={loading}
        onClick={handleClick}
        title={error ?? ariaLabel}
        aria-label={ariaLabel}
      >
        {loading ? null : <RefreshCw size={13} />}
        {loading ? '同步中…' : (label ?? '同步')}
      </Button>
      {error ? <span className="max-w-[220px] text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}

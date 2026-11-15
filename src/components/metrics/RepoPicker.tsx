'use client';

import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn, compact } from '@/lib/format';
import { MAX_COMPARE_REPOS } from './helpers';

export interface RepoPickerOption {
  fullName: string;
  stars: number;
}

/**
 * 多仓对比的仓库选择器：复选框，最多 4 个，变更即写回 URL（`?repos=a,b`，保留 `days`）。
 * 选择顺序即对比顺序（`repos` 参数的顺序）。
 */
export function RepoPicker({
  options,
  selected,
}: {
  options: RepoPickerOption[];
  selected: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const atLimit = selected.length >= MAX_COMPARE_REPOS;

  function apply(next: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.length === 0) params.delete('repos');
    else params.set('repos', next.join(','));
    const query = params.toString();
    startTransition(() => {
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  function toggle(fullName: string) {
    if (selected.includes(fullName)) {
      apply(selected.filter((name) => name !== fullName));
      return;
    }
    if (atLimit) return;
    apply([...selected, fullName]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className={cn('flex flex-wrap gap-2 transition-opacity', pending && 'opacity-60')}>
        {options.map((option) => {
          const checked = selected.includes(option.fullName);
          const disabled = !checked && atLimit;
          return (
            <label
              key={option.fullName}
              title={disabled ? `最多对比 ${MAX_COMPARE_REPOS} 个仓库` : option.fullName}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-[8px] border px-3 py-1.5 text-[12px] transition-colors',
                checked
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border bg-surface-2 text-muted hover:border-border-strong hover:text-text',
                disabled && 'cursor-not-allowed opacity-50 hover:border-border hover:text-muted',
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(option.fullName)}
                className="h-3.5 w-3.5 shrink-0 accent-accent"
              />
              <span className="tabular truncate">{option.fullName}</span>
              <span className="tabular shrink-0 text-[11px] text-subtle">
                ★ {compact(option.stars)}
              </span>
            </label>
          );
        })}
      </div>
      <p className={cn('text-[11px] leading-relaxed', atLimit ? 'text-warn' : 'text-subtle')}>
        {atLimit
          ? `已选 ${selected.length} 个，最多对比 ${MAX_COMPARE_REPOS} 个仓库；取消勾选后可重新选择。`
          : `已选 ${selected.length} 个，最多对比 ${MAX_COMPARE_REPOS} 个仓库。`}
      </p>
    </div>
  );
}

'use client';

import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/format';

/** 允许的区间（与 GET /api/aggregate 的 days 约束一致：7 / 30 / 90）。 */
const RANGES = [7, 30, 90] as const;

/**
 * 区间切换器：改写 `?days=` 后刷新服务端数据。
 * 刻意**不读** `useSearchParams`（避免额外的 Suspense 边界要求），当前区间由服务端以 props 传入。
 */
export function RangeSwitch({ days }: { days: number }) {
  const router = useRouter();
  const pathname = usePathname();

  function select(next: number) {
    if (next === days) return;
    router.push(`${pathname ?? '/'}?days=${next}`);
  }

  return (
    <div
      role="group"
      aria-label="时间区间"
      className="flex items-center gap-0.5 rounded-[var(--radius-sm)] border border-border bg-surface-2 p-0.5"
    >
      {RANGES.map((range) => {
        const active = range === days;
        return (
          <button
            key={range}
            type="button"
            aria-pressed={active}
            onClick={() => select(range)}
            className={cn(
              'tabular h-[22px] rounded-[4px] px-2 text-[11px] leading-none transition-colors',
              active
                ? 'bg-accent-soft font-medium text-accent'
                : 'text-muted hover:bg-surface hover:text-text',
            )}
          >
            {range} 天
          </button>
        );
      })}
    </div>
  );
}

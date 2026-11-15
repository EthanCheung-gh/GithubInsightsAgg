import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn, pct } from '@/lib/format';

const TONE_CHIP = {
  neutral: 'bg-surface-2 text-muted',
  good: 'bg-success-soft text-success',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
} as const;

export function KpiCard({
  label,
  value,
  delta,
  deltaLabel,
  hint,
  icon,
  tone = 'neutral',
  href,
}: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  deltaLabel?: string;
  hint?: string;
  icon?: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'danger';
  href?: string;
}) {
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta);
  const deltaValue = hasDelta ? (delta as number) : 0;
  const direction = deltaValue > 0 ? 'up' : deltaValue < 0 ? 'down' : 'flat';
  const deltaClass =
    direction === 'up' ? 'text-success' : direction === 'down' ? 'text-danger' : 'text-muted';
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';

  const body = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[11px] font-medium tracking-[0.06em] text-muted">{label}</div>
        <div className="kpi-value mt-1.5">{value}</div>
        {hasDelta || deltaLabel || hint ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
            {hasDelta ? (
              <span className={cn('tabular inline-flex items-center gap-0.5', deltaClass)}>
                <span aria-hidden>{arrow}</span>
                {pct(Math.abs(deltaValue))}
              </span>
            ) : null}
            {deltaLabel ? <span className="text-subtle">{deltaLabel}</span> : null}
            {hint ? <span className="text-subtle">{hint}</span> : null}
          </div>
        ) : null}
      </div>
      {icon ? (
        <div
          className={cn(
            // 图标贴住卡片右上角：`self-start` + 固定 32px 尺寸让它始终锚在内容区顶部，
            // 值换行 / 有 hint / 有 delta 都不会把图标拉向底部；
            // `-mt-2` 把 32px 图标块的中心对到 11px label 行的文本中心（正中偏上 8px），
            // 否则图标底边会压到数值那一行，看起来像「掉下去」了。
            '-mt-2 flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-[8px]',
            TONE_CHIP[tone],
          )}
        >
          {icon}
        </div>
      ) : null}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="card card--link block">
        {body}
      </Link>
    );
  }

  return <div className="card">{body}</div>;
}

import type { ReactNode } from 'react';
import { cn } from '@/lib/format';

const TONE_CLASS = {
  neutral: 'badge--neutral',
  good: 'badge--good',
  warn: 'badge--warn',
  danger: 'badge--danger',
  info: 'badge--info',
} as const;

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: 'neutral' | 'good' | 'warn' | 'danger' | 'info';
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn('badge', TONE_CLASS[tone], className)}>{children}</span>;
}

import type { ButtonHTMLAttributes } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/format';

const VARIANT_CLASS = {
  primary: 'btn--primary',
  ghost: 'btn--ghost',
  danger: 'btn--danger',
} as const;

const SIZE_CLASS = { sm: 'btn--sm', md: '' } as const;

export function Button({
  variant = 'ghost',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn('btn', VARIANT_CLASS[variant], SIZE_CLASS[size], className)}
    >
      {loading ? <LoaderCircle size={size === 'sm' ? 12 : 14} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

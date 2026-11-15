import type { ReactNode } from 'react';
import { cn } from '@/lib/format';

export function Card({
  title,
  subtitle,
  actions,
  className,
  bodyClassName,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const hasHead = title !== undefined || subtitle !== undefined || actions !== undefined;

  return (
    <section className={cn('card', className)}>
      {hasHead ? (
        <div className="card-head">
          <div className="min-w-0">
            {title !== undefined ? <h2 className="card-title">{title}</h2> : null}
            {subtitle !== undefined ? <div className="card-subtitle">{subtitle}</div> : null}
          </div>
          {actions !== undefined ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      <div className={cn('card-body', bodyClassName)}>{children}</div>
    </section>
  );
}

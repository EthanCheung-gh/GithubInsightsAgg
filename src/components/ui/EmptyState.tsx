import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-2 text-subtle">
        {icon ?? <Inbox size={18} />}
      </div>
      <p className="text-[13px] font-medium text-text">{title}</p>
      {description ? (
        <p className="max-w-sm text-[12px] leading-relaxed text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

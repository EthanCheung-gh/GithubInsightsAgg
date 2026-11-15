import type { ReactNode } from 'react';

/** 顶栏：56px 高，标题 15px/600，右侧放操作区。服务端组件。 */
export function TopBar({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex h-[56px] shrink-0 items-center justify-between gap-3 border-b border-border px-6">
      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold leading-tight text-text">{title}</div>
        {subtitle !== undefined ? (
          <div className="truncate text-[11px] leading-tight text-muted">{subtitle}</div>
        ) : null}
      </div>
      {actions !== undefined ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

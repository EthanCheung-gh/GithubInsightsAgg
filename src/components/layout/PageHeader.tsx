import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

/** 页面标题区：面包屑 + 22px 标题 + 副标题 + 右侧操作。服务端组件。 */
export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  breadcrumb?: { label: string; href?: string }[];
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {breadcrumb !== undefined && breadcrumb.length > 0 ? (
          <nav
            aria-label="面包屑"
            className="mb-1.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-subtle"
          >
            {breadcrumb.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {index > 0 ? <ChevronRight size={11} aria-hidden /> : null}
                {crumb.href !== undefined ? (
                  <Link href={crumb.href} className="hover:text-text">
                    {crumb.label}
                  </Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="truncate text-[22px] font-semibold leading-tight text-text">{title}</h1>
        {subtitle !== undefined ? (
          <p className="mt-1 text-[12px] leading-snug text-muted">{subtitle}</p>
        ) : null}
      </div>
      {actions !== undefined ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

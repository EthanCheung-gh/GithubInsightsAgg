'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FolderGit2, GitBranch, GitCompareArrows, LayoutDashboard, Settings } from 'lucide-react';
import { cn } from '@/lib/format';
import { ModeBadge } from './ModeBadge';
import type { LucideIcon } from 'lucide-react';

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: '总览', icon: LayoutDashboard },
  { href: '/repos', label: '仓库', icon: FolderGit2 },
  { href: '/compare', label: '对比', icon: GitCompareArrows },
  { href: '/settings', label: '设置', icon: Settings },
];

/** 允许 active 传 '/repos' 或 'repos'，统一成以 / 开头的路径 */
function normalizeActive(active: string): string {
  if (!active) return '/';
  const withSlash = active.startsWith('/') ? active : `/${active}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash;
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 左侧固定侧边栏（232px，全高 sticky）。
 * 高亮优先取 `active` prop，未传时回退到当前 pathname。
 */
export function Sidebar({ active, mode }: { active?: string; mode?: 'live' | 'demo' }) {
  const pathname = usePathname();
  const current = active !== undefined ? normalizeActive(active) : normalizeActive(pathname ?? '/');

  return (
    <aside
      className="sticky top-0 flex h-screen w-[232px] shrink-0 flex-col border-r border-border bg-bg-elevated"
      aria-label="主导航"
    >
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-accent-soft text-accent">
          <GitBranch size={16} aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold leading-tight text-text">
            GithubInsightsAgg
          </div>
          <div className="truncate text-[11px] leading-tight text-subtle">GitHub 洞察聚合</div>
        </div>
      </div>

      <nav className="scroll-thin flex-1 overflow-y-auto px-2 py-1">
        <ul className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const activeNow = isActive(current, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={activeNow ? 'page' : undefined}
                  className={cn(
                    'relative flex h-9 items-center gap-2.5 rounded-[var(--radius-sm)] px-3 text-[13px] transition-colors',
                    activeNow
                      ? 'bg-accent-soft font-medium text-accent'
                      : 'text-muted hover:bg-surface-2 hover:text-text',
                  )}
                >
                  {activeNow ? (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-accent"
                    />
                  ) : null}
                  <Icon size={15} aria-hidden className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {mode !== undefined ? (
        <div className="border-t border-border px-4 py-3">
          <ModeBadge mode={mode} />
        </div>
      ) : null}
    </aside>
  );
}

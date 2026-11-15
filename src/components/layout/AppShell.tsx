import type { ReactNode } from 'react';
import { effectiveMode } from '@/lib/sync';
import { Sidebar } from './Sidebar';

/**
 * 应用外壳：左侧固定 232px 侧边栏 + 右侧内容列。
 * 服务端组件，TopBar / PageHeader 由具体页面自行放置。
 */
export function AppShell({ children }: { children: ReactNode }) {
  // 与页面内的 ModeBadge 保持同一判定口径（env Token 或 gh auth token 回退）。
  const mode = effectiveMode();

  return (
    <div className="flex min-h-screen w-full bg-bg text-text">
      <Sidebar mode={mode} />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">{children}</main>
      </div>
    </div>
  );
}

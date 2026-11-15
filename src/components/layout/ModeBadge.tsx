import { cn } from '@/lib/format';

/**
 * 数据模式徽章：live = 实时数据（绿点），demo = 演示数据（黄点）。
 * 服务端组件，`mode` 由服务端（/api/health 或 resolveMode）传入。
 */
export function ModeBadge({ mode }: { mode: 'live' | 'demo' }) {
  const isLive = mode === 'live';
  const title = isLive
    ? '已配置 GITHUB_TOKEN，展示 GitHub 实时数据'
    : '未配置 GITHUB_TOKEN，当前展示合成数据';

  return (
    <span className={cn('badge', isLive ? 'badge--good' : 'badge--warn')} title={title}>
      <span
        aria-hidden
        className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', isLive ? 'bg-success' : 'bg-warn')}
      />
      {isLive ? '实时数据' : '演示数据'}
    </span>
  );
}

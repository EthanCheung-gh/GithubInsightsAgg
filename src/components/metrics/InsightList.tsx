import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/format';
import type { Insight } from '@/lib/types';

const LEVEL_DOT = {
  good: 'bg-success',
  info: 'bg-accent',
  warn: 'bg-warn',
  critical: 'bg-danger',
} as const;

const LEVEL_LABEL = {
  good: '良好',
  info: '提示',
  warn: '注意',
  critical: '严重',
} as const;

/** 规则化洞察列表（服务端组件，数据为纯对象）。 */
export function InsightList({
  insights,
  emptyTitle = '暂无洞察',
  emptyDescription,
}: {
  insights: Insight[];
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (insights.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <ul className="flex flex-col gap-3">
      {insights.map((insight, index) => (
        <li key={`${insight.title}-${index}`} className="flex items-start gap-2">
          <span
            aria-hidden
            className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', LEVEL_DOT[insight.level])}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium leading-snug text-text">{insight.title}</span>
              <span className="text-[10px] leading-none text-subtle">{LEVEL_LABEL[insight.level]}</span>
            </div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{insight.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/format';
import type { Insight } from '@/lib/types';

/** level → 左侧色点（只用主题色，禁止硬编码色值）。 */
const LEVEL_DOT: Record<Insight['level'], string> = {
  good: 'bg-success',
  info: 'bg-accent',
  warn: 'bg-warn',
  critical: 'bg-danger',
};

const LEVEL_LABEL: Record<Insight['level'], string> = {
  good: '良好',
  info: '提示',
  warn: '注意',
  critical: '严重',
};

/** 洞察列表：服务端组件（纯展示，无交互）。 */
export function InsightList({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) {
    return <EmptyState title="暂无洞察" description="采集到足够数据后，这里会给出规则化的分析建议。" />;
  }

  return (
    <ul className="flex flex-col gap-3">
      {insights.map((insight, index) => (
        <li key={`${insight.level}-${insight.title}-${index}`} className="flex items-start gap-2">
          <span
            aria-hidden
            className={cn('mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full', LEVEL_DOT[insight.level])}
            title={LEVEL_LABEL[insight.level]}
          />
          <div className="min-w-0">
            <p className="text-[13px] font-medium leading-snug text-text">{insight.title}</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{insight.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

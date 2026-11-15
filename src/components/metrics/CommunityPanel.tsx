import { Check, Minus } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { cn } from '@/lib/format';
import type { CommunityInfo } from '@/lib/types';
import { healthTone } from './helpers';

/** 社区健康：健康度进度条 + 检查项清单（服务端组件）。 */
export function CommunityPanel({ community }: { community: CommunityInfo | null }) {
  if (!community) {
    return (
      <EmptyState
        title="未采集社区档案"
        description="同步该仓库后会拉取 README / LICENSE / Issue 模板等社区健康数据。"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ProgressBar
        value={community.healthPercentage}
        max={100}
        tone={healthTone(community.healthPercentage)}
        label="社区健康度"
      />
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {community.checklist.map((item) => (
          <li key={item.key} className="flex items-center gap-2 text-[12px] leading-snug">
            <span
              aria-hidden
              className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                item.ok ? 'bg-success-soft text-success' : 'bg-surface-2 text-subtle',
              )}
            >
              {item.ok ? <Check size={11} /> : <Minus size={11} />}
            </span>
            <span className={item.ok ? 'text-text' : 'text-muted'}>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

'use client';

import { cn, num } from '@/lib/format';

export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: string; label: string; count?: number }[];
  value: string;
  onChange: (k: string) => void;
}) {
  return (
    <div role="tablist" className="scroll-thin flex items-center gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={cn(
              '-mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[13px] transition-colors',
              active
                ? 'border-accent font-medium text-text'
                : 'border-transparent text-muted hover:text-text',
            )}
          >
            {tab.label}
            {typeof tab.count === 'number' ? (
              <span
                className={cn(
                  'tabular rounded-full px-1.5 py-0.5 text-[10px] leading-none',
                  active ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-subtle',
                )}
              >
                {num(tab.count)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

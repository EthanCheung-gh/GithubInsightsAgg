'use client';

import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from '@/components/ui/Tabs';
import { cn } from '@/lib/format';

const DETAIL_TABS = [
  { key: 'overview', label: '概览' },
  { key: 'traffic', label: '流量' },
  { key: 'activity', label: '活跃度' },
  { key: 'code', label: '代码量' },
  { key: 'issues', label: 'Issues & PR' },
];

/**
 * 仓库详情页签：服务端驱动，切页签只改 `tab`，`days` 等参数原样保留。
 * 用 `router.replace` 而不是 `push`，避免来回切页签把浏览器历史撑满。
 */
export function DetailTabs({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function handleChange(nextKey: string) {
    if (nextKey === value) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', nextKey);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className={cn('min-w-0 transition-opacity', pending && 'opacity-60')}>
      <Tabs tabs={DETAIL_TABS.map((tab) => ({ key: tab.key, label: tab.label }))} value={value} onChange={handleChange} />
    </div>
  );
}

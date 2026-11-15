'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from '@/components/ui/Tabs';

const RANGES = [
  { key: '7', label: '7 天' },
  { key: '30', label: '30 天' },
  { key: '90', label: '90 天' },
];

/**
 * 区间切换器：只改 `days`，其余查询参数（`tab` / `repos`）原样保留。
 * 服务端驱动 —— 切换后由 Server Component 重新计算指标，刷新后状态不丢。
 */
export function RangeSwitch({ value }: { value: number | string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(nextKey: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('days', nextKey);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="min-w-0 max-w-full">
      <Tabs tabs={RANGES} value={String(value)} onChange={handleChange} />
    </div>
  );
}

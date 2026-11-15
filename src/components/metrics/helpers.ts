import { weekdayCn } from '@/lib/date';
import type { CommitPoint } from '@/lib/types';

/** 纯模块（无 `'use client'`）：服务端与客户端组件都可以引用。 */

export type HealthTone = 'good' | 'warn' | 'danger';

/** 健康度分档：>=70 good，>=45 warn，其余 danger。 */
export function healthTone(score: number): HealthTone {
  const value = Number.isFinite(score) ? score : 0;
  if (value >= 70) return 'good';
  if (value >= 45) return 'warn';
  return 'danger';
}

export const WEEKDAY_ORDER = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

/** 对比页最多同时选择的仓库数。 */
export const MAX_COMPARE_REPOS = 4;

/** 把逐日提交序列按「周一→周日」聚合，供 WeekdayBarChart 使用。 */
export function commitsByWeekday(commits: CommitPoint[]): { label: string; value: number }[] {
  const buckets = new Map<string, number>();
  for (const point of commits) {
    const count = Number.isFinite(point.count) ? point.count : 0;
    const bucket = weekdayCn(point.date);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + count);
  }
  return WEEKDAY_ORDER.map((label) => ({ label, value: buckets.get(label) ?? 0 }));
}

/** 带符号的整数文案：`+1,234` / `-12` / `0`。 */
export function signedNum(value: number): string {
  const safe = Number.isFinite(value) ? Math.trunc(value) : 0;
  if (safe > 0) return `+${safe.toLocaleString('en-US')}`;
  return safe.toLocaleString('en-US');
}

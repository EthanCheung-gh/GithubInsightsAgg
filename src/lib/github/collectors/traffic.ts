import { toDateKey } from '../../date';
import { rest } from '../client';
import type {
  TrafficClonesResponse,
  TrafficPathItem,
  TrafficReferrerItem,
  TrafficResult,
  TrafficViewsResponse,
} from '../types';

/** Traffic 只能覆盖有 push 权限的仓库；仓库不存在时 REST 返回 404。 */
const PER_PAGE_DAILY = { per: 'day' } as const;

function enc(value: string): string {
  return encodeURIComponent(value);
}

function toInt(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}

interface DailyAccumulator {
  views: number;
  uniqueVisitors: number;
  clones: number;
  uniqueCloners: number;
}

function emptyDay(): DailyAccumulator {
  return { views: 0, uniqueVisitors: 0, clones: 0, uniqueCloners: 0 };
}

/** Traffic 的 timestamp 是 UTC 零点 ISO 串；非法值直接跳过该点。 */
function dayKeyOf(timestamp: unknown): string | null {
  if (typeof timestamp !== 'string') return null;
  try {
    return toDateKey(timestamp);
  } catch {
    return null;
  }
}

/**
 * 访问量与克隆量。
 *
 * `/traffic/views` 与 `/traffic/clones` 的日期集合不一定对齐（例如某天零访问时
 * 该接口可能不带这条记录），因此按 `toDateKey(timestamp)` 建 map，最后取并集、
 * 缺失侧补 0，保证逐日序列完整。
 *
 * 返回 null 只有一种情况：仓库对该 Token 完全不可见（views 404）。
 * 无权限（403）与限流由 client 直接抛错，向上冒泡给 sync.ts 记为失败。
 * sync.ts 在 null 分支不写任何 traffic 表，因此不会清空历史数据。
 */
export async function fetchTraffic(owner: string, name: string): Promise<TrafficResult | null> {
  const base = `/repos/${enc(owner)}/${enc(name)}`;

  // views 的 404 是「仓库不可见」的显式信号 → 返回 null（sync 侧整组跳过写入）
  const views = await rest<TrafficViewsResponse>(`${base}/traffic/views`, {
    params: { ...PER_PAGE_DAILY },
    allow404: true,
  });
  if (!views) return null;

  // clones 不加 allow404：非 2xx 直接抛错，避免把 clones 列静默写成 0
  const clones = await rest<TrafficClonesResponse>(`${base}/traffic/clones`, {
    params: { ...PER_PAGE_DAILY },
  });

  const byDate = new Map<string, DailyAccumulator>();
  const ensure = (date: string): DailyAccumulator => {
    const existing = byDate.get(date);
    if (existing) return existing;
    const created = emptyDay();
    byDate.set(date, created);
    return created;
  };

  for (const point of views.views ?? []) {
    if (!point) continue;
    const date = dayKeyOf(point.timestamp);
    if (!date) continue;
    const slot = ensure(date);
    slot.views += toInt(point.count);
    slot.uniqueVisitors += toInt(point.uniques);
  }

  for (const point of clones?.clones ?? []) {
    if (!point) continue;
    const date = dayKeyOf(point.timestamp);
    if (!date) continue;
    const slot = ensure(date);
    slot.clones += toInt(point.count);
    slot.uniqueCloners += toInt(point.uniques);
  }

  const daily = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, acc]) => ({
      date,
      views: acc.views,
      uniqueVisitors: acc.uniqueVisitors,
      clones: acc.clones,
      uniqueCloners: acc.uniqueCloners,
    }));

  // referrers / paths 不加 allow404：非 2xx（403/404/5xx）一律抛错，
  // 让整组 traffic 记为失败且**不写库**，而不是用空数组把历史排行清空。
  // 200 + [] 才是「最近 14 天确实没有流量」，此时允许覆盖。
  const referrers = await rest<TrafficReferrerItem[]>(`${base}/traffic/popular/referrers`);
  const paths = await rest<TrafficPathItem[]>(`${base}/traffic/popular/paths`);

  return {
    daily,
    referrers: (referrers ?? [])
      .filter((item) => item && typeof item.referrer === 'string')
      .map((item) => ({
        referrer: item.referrer,
        count: toInt(item.count),
        uniques: toInt(item.uniques),
      })),
    paths: (paths ?? [])
      .filter((item) => item && typeof item.path === 'string')
      .map((item) => ({
        path: item.path,
        title: typeof item.title === 'string' && item.title.trim() !== '' ? item.title : null,
        count: toInt(item.count),
        uniques: toInt(item.uniques),
      })),
  };
}

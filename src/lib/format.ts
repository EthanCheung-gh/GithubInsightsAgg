/**
 * 前端格式化工具（服务端 / 客户端通用，无副作用、无 locale 依赖）。
 * 契约见 docs/CONTRACTS.md §8。
 */

const EMPTY = '—';

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 千分位整数/小数：1234 -> '1,234' */
function groupThousands(v: number): string {
  const negative = v < 0;
  const [intPart, decPart] = Math.abs(v).toString().split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = decPart ? `${grouped}.${decPart}` : grouped;
  return negative ? `-${body}` : body;
}

/** 保留最多 digits 位小数并去掉末尾的 0 */
function trimFixed(v: number, digits: number): string {
  const fixed = v.toFixed(digits);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** 1234 -> '1,234' */
export function num(v: number | null | undefined): string {
  if (!isNum(v)) return EMPTY;
  return groupThousands(v);
}

/** 12345 -> '1.2万'，123456789 -> '1.2亿' */
export function compact(v: number | null | undefined): string {
  if (!isNum(v)) return EMPTY;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e8) return `${sign}${trimFixed(abs / 1e8, 1)}亿`;
  if (abs >= 1e4) return `${sign}${trimFixed(abs / 1e4, 1)}万`;
  return groupThousands(v);
}

/** 0.1234 -> '12.3%'（入参为 0~1 的比值） */
export function pct(v: number | null | undefined, digits = 1): string {
  if (!isNum(v)) return EMPTY;
  return `${(v * 100).toFixed(digits)}%`;
}

/** 1.0 表示 +100%；prev <= 0 或入参非法时返回 null */
export function deltaPct(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
  return (cur - prev) / prev;
}

/** '2026-03-02' -> '3/2' */
export function shortDate(d: string | null | undefined): string {
  if (!d) return EMPTY;
  const datePart = d.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return d;
  const month = Number(match[2]);
  const day = Number(match[3]);
  return `${month}/${day}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** '3 分钟前' / '2 小时后' */
export function relTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const ts = Date.parse(iso.length <= 10 ? `${iso.slice(0, 10)}T00:00:00Z` : iso);
  if (!Number.isFinite(ts)) return EMPTY;

  const diff = Date.now() - ts;
  const suffix = diff >= 0 ? '前' : '后';
  const abs = Math.abs(diff);

  if (abs < 45_000) return '刚刚';
  if (abs < HOUR) return `${Math.max(1, Math.round(abs / MINUTE))} 分钟${suffix}`;
  if (abs < DAY) return `${Math.round(abs / HOUR)} 小时${suffix}`;
  if (abs < 30 * DAY) return `${Math.round(abs / DAY)} 天${suffix}`;
  if (abs < 365 * DAY) return `${Math.max(1, Math.round(abs / (30 * DAY)))} 个月${suffix}`;
  return `${Math.max(1, Math.round(abs / (365 * DAY)))} 年${suffix}`;
}

/** 条件拼接 className，忽略 false / null / undefined */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

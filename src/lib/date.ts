export const DAY_MS = 86_400_000;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function parseKey(key: string): Date {
  if (!DATE_KEY_RE.test(key)) {
    throw new RangeError(`invalid date key: ${key}`);
  }
  const date = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`invalid date key: ${key}`);
  }
  return date;
}

export function toDateKey(d: Date | string | number): string {
  let date: Date;
  if (d instanceof Date) {
    date = d;
  } else if (typeof d === 'number') {
    date = new Date(d);
  } else {
    const trimmed = d.trim();
    if (DATE_KEY_RE.test(trimmed)) return trimmed;
    date = new Date(trimmed);
  }
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`invalid date value: ${String(d)}`);
  }
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

export function addDaysKey(key: string, n: number): string {
  const base = parseKey(key).getTime();
  return toDateKey(base + Math.trunc(n) * DAY_MS);
}

export function diffDays(fromKey: string, toKey: string): number {
  return Math.round((parseKey(toKey).getTime() - parseKey(fromKey).getTime()) / DAY_MS);
}

export function rangeKeys(days: number, endKey?: string): string[] {
  const length = Math.max(1, Math.trunc(Number.isFinite(days) ? days : 1));
  const end = endKey && isDateKey(endKey) ? endKey : todayKey();
  const out: string[] = [];
  for (let i = length - 1; i >= 0; i -= 1) {
    out.push(addDaysKey(end, -i));
  }
  return out;
}

export function isDateKey(v: string): boolean {
  if (typeof v !== 'string' || !DATE_KEY_RE.test(v)) return false;
  const date = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;
  return toDateKey(date) === v;
}

export function weekdayCn(key: string): string {
  return WEEKDAYS_CN[parseKey(key).getUTCDay()] ?? '周日';
}

export function toIso(d: Date | string | null | undefined): string | null {
  if (d === null || d === undefined) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

import { addDaysKey, toDateKey, todayKey } from '../../date';
import { githubErrorMessage, rest } from '../client';
import {
  GithubApiError,
  type ActivityResult,
  type CommitActivityWeek,
  type ContributorItem,
  type ParticipationResponse,
  type SectionResult,
} from '../types';

/** `GET /stats/*` 未命中缓存时返回 202 + 空 body，需要退避重试（增补 A5）。 */
const STATS_BACKOFF_MS = [1000, 2000, 4000];
const COMMIT_WINDOW_WEEKS = 52;
const PARTICIPATION_WEEKS = 52;
const CONTRIBUTOR_PAGE_SIZE = 100;

type DailyPoint = { date: string; count: number };
type WeeklyPoint = { weekStart: string; commits: number; additions: number; deletions: number };
type ContributorPoint = {
  login: string;
  avatarUrl: string | null;
  contributions: number;
  type: string;
};

/** 一次统计请求的结论：成功（可能为空）或不可用（附原因）。 */
type FetchOutcome<T> = { ok: true; data: T | null } | { ok: false; reason: string };

function enc(value: string): string {
  return encodeURIComponent(value);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toInt(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}

/**
 * `/stats/*` 请求。
 *
 * **刻意不使用 `allow202` / `allow404`**：需要把「202 计算中」「404 不可用」
 * 与「2xx 但确实没有数据（204/空 body → null）」区分开。前两者必须让调用方
 * 跳过写库，后者才允许用空数组覆盖旧值。
 *
 * 202 → 1s/2s/4s 退避重试 3 次；仍未就绪则返回 `ok: false`（增补 A5：skipped）。
 */
async function requestStats<T>(path: string, label: string): Promise<FetchOutcome<T>> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // 无 allow202/allow404：非 2xx 一律抛 GithubApiError
      const data = await rest<T>(path);
      return { ok: true, data };
    } catch (error) {
      const status = error instanceof GithubApiError ? error.status : 0;
      if (status === 202) {
        if (attempt < STATS_BACKOFF_MS.length) {
          await sleep(STATS_BACKOFF_MS[attempt] ?? 4000);
          continue;
        }
        return {
          ok: false,
          reason: `${label} 计算中(202)，退避重试 ${STATS_BACKOFF_MS.length} 次后仍不可用`,
        };
      }
      if (status === 404) {
        return { ok: false, reason: `${label} 不可用(404)` };
      }
      return { ok: false, reason: `${label} 请求失败: ${githubErrorMessage(error)}` };
    }
  }
}

/** 取给定日期所在周的周一（UTC，周一起算）。 */
function mondayOf(key: string): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  const weekday = date.getUTCDay(); // 0=周日
  const offset = (weekday + 6) % 7;
  return addDaysKey(key, -offset);
}

/**
 * `code_frequency` 的周时间戳按 GitHub 惯例是周起始（周日/周一共两种历史口径）。
 * 统一折算到「该周周一」，与 participation 的 week_start 对齐。
 */
function weekKeyFromTimestamp(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  let key: string;
  try {
    key = toDateKey(seconds * 1000);
  } catch {
    return null;
  }
  // 若是周日（GitHub 常见的周起点），其所在周的周一在次日。
  const weekday = new Date(`${key}T00:00:00.000Z`).getUTCDay();
  return weekday === 0 ? addDaysKey(key, 1) : mondayOf(key);
}

/** `commit_activity`：52 个 `{ week, days[7] }` 展开为逐日。 */
function expandCommitActivity(weeks: CommitActivityWeek[]): DailyPoint[] {
  const byDate = new Map<string, number>();
  const sorted = [...weeks]
    .filter((week) => week && typeof week.week === 'number' && Number.isFinite(week.week))
    .sort((a, b) => a.week - b.week);

  for (const week of sorted) {
    let weekStart: string;
    try {
      weekStart = toDateKey(week.week * 1000);
    } catch {
      continue;
    }
    const days = Array.isArray(week.days) ? week.days : [];
    for (let i = 0; i < days.length && i < 7; i += 1) {
      const date = addDaysKey(weekStart, i);
      byDate.set(date, (byDate.get(date) ?? 0) + toInt(days[i]));
    }
  }

  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, count]) => ({ date, count }));
}

interface WeeklyAccumulator {
  commits: number;
  additions: number;
  deletions: number;
}

/** participation + code_frequency 合并成周参与度；任一段不可用则整体不可用。 */
function buildWeekly(
  participation: FetchOutcome<ParticipationResponse>,
  frequency: FetchOutcome<number[][]>,
): SectionResult<WeeklyPoint> {
  const unavailable = [participation, frequency]
    .filter((outcome): outcome is { ok: false; reason: string } => !outcome.ok)
    .map((outcome) => outcome.reason);
  if (unavailable.length > 0) {
    // 只要一段不可用就整体 skipped：否则会出现「commits 正常但 additions 全 0」
    // 这种半边数据覆盖旧值的情况。
    return { rows: [], skipped: true, reason: unavailable.join('; ') };
  }

  const weekly = new Map<string, WeeklyAccumulator>();
  const ensureWeek = (weekStart: string): WeeklyAccumulator => {
    const existing = weekly.get(weekStart);
    if (existing) return existing;
    const created: WeeklyAccumulator = { commits: 0, additions: 0, deletions: 0 };
    weekly.set(weekStart, created);
    return created;
  };

  const participationData = participation.ok ? participation.data : null;
  const all = Array.isArray(participationData?.all) ? participationData.all : [];
  const series = all.slice(-PARTICIPATION_WEEKS);
  const currentMonday = mondayOf(todayKey());
  const lastIndex = series.length - 1;
  for (let i = 0; i < series.length; i += 1) {
    const weekStart = addDaysKey(currentMonday, -(lastIndex - i) * 7);
    ensureWeek(weekStart).commits = toInt(series[i]);
  }

  const frequencyData = frequency.ok ? frequency.data : null;
  for (const row of frequencyData ?? []) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const weekStart = weekKeyFromTimestamp(Number(row[0]));
    if (!weekStart) continue;
    const slot = ensureWeek(weekStart);
    slot.additions = Math.max(0, toInt(Number(row[1])));
    // 增补 A5：deletions 是负数，入库前取绝对值
    slot.deletions = Math.abs(toInt(Number(row[2])));
  }

  const rows = [...weekly.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([weekStart, acc]) => ({
      weekStart,
      commits: acc.commits,
      additions: acc.additions,
      deletions: acc.deletions,
    }));

  return { rows, skipped: false };
}

/** `/contributors`：204/空 body → 成功且确实没有贡献者；404/403 → 不可用。 */
async function fetchContributors(
  path: string,
): Promise<SectionResult<ContributorPoint>> {
  try {
    // 同样不加 allow404：404 必须被判定为「不可用」而不是「没有贡献者」。
    const items = await rest<ContributorItem[]>(path, {
      params: { per_page: CONTRIBUTOR_PAGE_SIZE },
    });
    const rows = (items ?? [])
      .filter((item) => item && typeof item.login === 'string' && item.login.trim() !== '')
      .map((item) => ({
        login: String(item.login),
        avatarUrl: typeof item.avatar_url === 'string' ? item.avatar_url : null,
        contributions: toInt(item.contributions),
        type: typeof item.type === 'string' && item.type.trim() !== '' ? item.type : 'User',
      }))
      .sort((a, b) => b.contributions - a.contributions || a.login.localeCompare(b.login));
    return { rows, skipped: false };
  } catch (error) {
    const status = error instanceof GithubApiError && error.status > 0 ? `(${error.status})` : '';
    return {
      rows: [],
      skipped: true,
      reason: `contributors 不可用${status}: ${githubErrorMessage(error)}`,
    };
  }
}

/**
 * 活跃度三件套：逐日提交、周参与度（提交数 + 增删行）、贡献者。
 *
 * 每段独立返回 `SectionResult`：
 * - 202 重试用尽 / 404 / 403 / 网络错误 → `skipped: true`（调用方必须跳过写库）；
 * - 2xx 但没有数据 → `skipped: false, rows: []`（可安全覆盖）。
 * 本函数不会抛异常：单段失败不影响其他段，由 sync.ts 汇入 failures。
 */
export async function fetchActivity(owner: string, name: string): Promise<ActivityResult> {
  const base = `/repos/${enc(owner)}/${enc(name)}`;

  // 三个 /stats/* 相互独立，并发发起；client 内部已做串行节流。
  const [commitOutcome, participationOutcome, frequencyOutcome] = await Promise.all([
    requestStats<CommitActivityWeek[]>(`${base}/stats/commit_activity`, 'commit_activity'),
    requestStats<ParticipationResponse>(`${base}/stats/participation`, 'participation'),
    requestStats<number[][]>(`${base}/stats/code_frequency`, 'code_frequency'),
  ]);

  let commitDays: SectionResult<DailyPoint>;
  if (!commitOutcome.ok) {
    commitDays = { rows: [], skipped: true, reason: commitOutcome.reason };
  } else {
    const weeks = Array.isArray(commitOutcome.data)
      ? commitOutcome.data.slice(-COMMIT_WINDOW_WEEKS)
      : [];
    commitDays = { rows: expandCommitActivity(weeks), skipped: false };
  }

  const weekly = buildWeekly(participationOutcome, frequencyOutcome);
  const contributors = await fetchContributors(`${base}/contributors`);

  return { commitDays, weekly, contributors };
}

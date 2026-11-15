import { isDateKey, rangeKeys, toDateKey } from '../../date';
import { graphql } from '../client';
import type { GraphQLIssuePrResponse, IssuesResult } from '../types';

const PAGE_SIZE = 100;

/** 一次 GraphQL 同时取 open issues 数 + 最近 100 条 issue / PR（增补 A5）。 */
const ISSUE_PR_QUERY = `
query IssuePrDaily($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    openIssues: issues(states: OPEN) { totalCount }
    issues(first: ${PAGE_SIZE}, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes { createdAt closedAt }
    }
    pullRequests(first: ${PAGE_SIZE}, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes { createdAt closedAt mergedAt }
    }
  }
}
`;

interface DayBucket {
  issuesOpened: number;
  issuesClosed: number;
  prOpened: number;
  prMerged: number;
  prClosed: number;
}

function emptyBucket(): DayBucket {
  return { issuesOpened: 0, issuesClosed: 0, prOpened: 0, prMerged: 0, prClosed: 0 };
}

/** GraphQL 的时间戳是 ISO 串；非法值返回 null（跳过该记录）。 */
function dayKeyOf(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const key = toDateKey(value);
    return isDateKey(key) ? key : null;
  } catch {
    return null;
  }
}

/**
 * Issues / PR 健康度：本地按日聚合，仅保留最近 `days` 天。
 *
 * 口径（增补 A5）：
 * - prOpened 按 createdAt，prMerged 按 mergedAt，prClosed 仅计 closedAt != null && mergedAt == null；
 * - issuesOpened 按 createdAt，issuesClosed 按 closedAt。
 *
 * 窗口内每一天都会产出一行（含全 0），保证趋势图无断点、写库行数稳定。
 */
export async function fetchIssuesAndPrs(
  owner: string,
  name: string,
  days: number,
): Promise<IssuesResult> {
  const data = await graphql<GraphQLIssuePrResponse>(ISSUE_PR_QUERY, { owner, name });
  const repository = data.repository;

  // repository 为 null（无权限 / 仓库不可见）时不能返回「全 0 的 days 行」，
  // 否则 replaceIssuePrDaily 会把历史 issue/PR 曲线清空。抛错交由 sync.ts 记失败。
  if (!repository) {
    throw new Error('graphql: repository 为空（无权限或仓库不可见），已跳过写入');
  }

  const keys = rangeKeys(Math.max(1, Math.trunc(days)));
  const window = new Set(keys);
  const buckets = new Map<string, DayBucket>();
  for (const key of keys) buckets.set(key, emptyBucket());

  const bucketOf = (key: string | null): DayBucket | null => {
    if (!key || !window.has(key)) return null;
    return buckets.get(key) ?? null;
  };

  for (const node of repository?.issues?.nodes ?? []) {
    if (!node) continue;
    const opened = bucketOf(dayKeyOf(node.createdAt));
    if (opened) opened.issuesOpened += 1;
    const closed = bucketOf(dayKeyOf(node.closedAt));
    if (closed) closed.issuesClosed += 1;
  }

  for (const node of repository?.pullRequests?.nodes ?? []) {
    if (!node) continue;
    const opened = bucketOf(dayKeyOf(node.createdAt));
    if (opened) opened.prOpened += 1;

    const merged = dayKeyOf(node.mergedAt);
    if (merged) {
      const target = bucketOf(merged);
      if (target) target.prMerged += 1;
    }

    // 只在「关闭但未合并」时计入 prClosed，避免与 prMerged 重复计数。
    const closed = dayKeyOf(node.closedAt);
    if (closed && !merged) {
      const target = bucketOf(closed);
      if (target) target.prClosed += 1;
    }
  }

  const daily = keys.map((date) => {
    const bucket = buckets.get(date) ?? emptyBucket();
    return { date, ...bucket };
  });

  const openIssues =
    typeof repository?.openIssues?.totalCount === 'number'
      ? Math.trunc(repository.openIssues.totalCount)
      : null;

  return { daily, openIssues };
}

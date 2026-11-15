import { toIso } from '../../date';
import { graphql, rest } from '../client';
import type {
  GraphQLRepoCounts,
  RepoBasics,
  RestRepoResponse,
} from '../types';

export type { RepoBasics } from '../types';

/** 一次 GraphQL 同时取回 open issues / open PRs / watchers（见 A5）。 */
const REPO_COUNTS_QUERY = `
query RepoCounts($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN) { totalCount }
    pullRequests(states: OPEN) { totalCount }
    watchers { totalCount }
  }
}
`;

function enc(value: string): string {
  return encodeURIComponent(value);
}

function toInt(value: number | null | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/**
 * 仓库基础信息。404 -> null（上层据此判定 repo_not_found）。
 * openIssues / watchers / openPullRequests 优先走 GraphQL，失败时回退 REST
 * （REST 的 open_issues_count 含 PR，会有偏差；watchers 回退为 0）。
 */
export async function fetchRepoBasics(owner: string, name: string): Promise<RepoBasics | null> {
  const data = await rest<RestRepoResponse>(`/repos/${enc(owner)}/${enc(name)}`, {
    allow404: true,
  });
  if (!data) return null;

  const basics: RepoBasics = {
    description: typeof data.description === 'string' ? data.description : null,
    htmlUrl: typeof data.html_url === 'string' ? data.html_url : null,
    defaultBranch: typeof data.default_branch === 'string' ? data.default_branch : null,
    language: typeof data.language === 'string' ? data.language : null,
    topics: Array.isArray(data.topics)
      ? data.topics.filter((item): item is string => typeof item === 'string')
      : [],
    isPrivate: data.private === true,
    isArchived: data.archived === true,
    stars: toInt(data.stargazers_count),
    forks: toInt(data.forks_count),
    openIssues: toInt(data.open_issues_count),
    watchers: 0,
    pushedAt: toIso(data.pushed_at ?? null),
  };

  try {
    const counts = await graphql<GraphQLRepoCounts>(REPO_COUNTS_QUERY, { owner, name });
    const repo = counts.repository;
    if (repo) {
      if (repo.issues) basics.openIssues = toInt(repo.issues.totalCount);
      if (repo.pullRequests) basics.openPullRequests = toInt(repo.pullRequests.totalCount);
      if (repo.watchers) basics.watchers = toInt(repo.watchers.totalCount);
    }
  } catch {
    // GraphQL 不可用：保留 REST 的 open_issues_count（含 PR，已知偏差），watchers 记 0。
  }

  return basics;
}

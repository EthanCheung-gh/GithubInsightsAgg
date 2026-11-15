/**
 * GitHub 采集层的公共类型：错误类型、限流信息、REST/GraphQL 原始响应形状，
 * 以及各 collector 返回的中间结构（由 sync.ts 统一落库）。
 */

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  resetAt: string;
}

/** Token 实际来源：环境变量 / gh CLI / 无。 */
export type TokenSource = 'env' | 'gh-cli' | 'none';

export interface TokenResolution {
  token: string | null;
  source: TokenSource;
}

/** 所有 GitHub 调用失败统一抛此错误（status = 0 表示网络层错误）。 */
export class GithubApiError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string, message: string) {
    super(message);
    this.name = 'GithubApiError';
    this.status = status;
    this.path = path;
  }
}

/* ------------------------------------------------------------------ */
/* 原始 REST 响应                                                      */
/* ------------------------------------------------------------------ */

export interface RestRepoResponse {
  description?: string | null;
  html_url?: string | null;
  default_branch?: string | null;
  language?: string | null;
  topics?: string[] | null;
  private?: boolean;
  archived?: boolean;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  pushed_at?: string | null;
}

export interface TrafficSeriesPoint {
  timestamp: string;
  count: number;
  uniques: number;
}

export interface TrafficViewsResponse {
  count?: number;
  uniques?: number;
  views?: TrafficSeriesPoint[];
}

export interface TrafficClonesResponse {
  count?: number;
  uniques?: number;
  clones?: TrafficSeriesPoint[];
}

export interface TrafficReferrerItem {
  referrer: string;
  count: number;
  uniques: number;
}

export interface TrafficPathItem {
  path: string;
  title?: string | null;
  count: number;
  uniques: number;
}

export interface CommitActivityWeek {
  week: number;
  total?: number;
  days?: number[];
}

export interface ParticipationResponse {
  all?: number[];
  owner?: number[];
}

export interface ContributorItem {
  login?: string;
  avatar_url?: string | null;
  contributions?: number;
  type?: string;
}

export interface ReleaseItem {
  tag_name?: string;
  name?: string | null;
  published_at?: string | null;
  prerelease?: boolean;
  draft?: boolean;
}

export interface CommunityProfileFiles {
  readme?: unknown;
  license?: unknown;
  contributing?: unknown;
  code_of_conduct?: unknown;
  issue_template?: unknown;
  pull_request_template?: unknown;
}

export interface CommunityProfileResponse {
  health_percentage?: number;
  description?: string | null;
  files?: CommunityProfileFiles | null;
}

/* ------------------------------------------------------------------ */
/* 原始 GraphQL 响应                                                   */
/* ------------------------------------------------------------------ */

export interface GraphQLCount {
  totalCount: number;
}

export interface GraphQLRepoCounts {
  repository:
    | {
        issues?: GraphQLCount | null;
        pullRequests?: GraphQLCount | null;
        watchers?: GraphQLCount | null;
      }
    | null;
}

export interface GraphQLIssueNode {
  createdAt: string | null;
  closedAt: string | null;
}

export interface GraphQLPullNode {
  createdAt: string | null;
  closedAt: string | null;
  mergedAt: string | null;
}

export interface GraphQLIssuePrResponse {
  repository:
    | {
        openIssues?: GraphQLCount | null;
        issues?: { nodes?: GraphQLIssueNode[] | null } | null;
        pullRequests?: { nodes?: GraphQLPullNode[] | null } | null;
      }
    | null;
}

/* ------------------------------------------------------------------ */
/* collector 中间结构                                                   */
/* ------------------------------------------------------------------ */

export interface RepoBasics {
  description: string | null;
  htmlUrl: string | null;
  defaultBranch: string | null;
  language: string | null;
  topics: string[];
  isPrivate: boolean;
  isArchived: boolean;
  stars: number;
  forks: number;
  openIssues: number;
  watchers: number;
  pushedAt: string | null;
  /** GraphQL 成功时附带的开放 PR 数（供 issues collector / 展示使用）。 */
  openPullRequests?: number;
}

export interface TrafficResult {
  daily: {
    date: string;
    views: number;
    uniqueVisitors: number;
    clones: number;
    uniqueCloners: number;
  }[];
  referrers: { referrer: string; count: number; uniques: number }[];
  paths: { path: string; title: string | null; count: number; uniques: number }[];
}

/**
 * 单个采集段的结果。
 *
 * `skipped` 与「成功但真的为空」是两件事：
 * - `skipped: false` + `rows: []` → HTTP 2xx 且确实没有数据，可以安全覆盖旧数据；
 * - `skipped: true` → 未就绪（202 重试用尽）/ 不可用（404/403/网络）→ 调用方**禁止写库**，
 *   否则 `replace*` 的 DELETE 会把历史数据静默清空。
 */
export interface SectionResult<T> {
  rows: T[];
  skipped: boolean;
  reason?: string;
}

export interface ActivityResult {
  commitDays: SectionResult<{ date: string; count: number }>;
  weekly: SectionResult<{
    weekStart: string;
    commits: number;
    additions: number;
    deletions: number;
  }>;
  contributors: SectionResult<{
    login: string;
    avatarUrl: string | null;
    contributions: number;
    type: string;
  }>;
}

export interface IssuesResult {
  daily: {
    date: string;
    issuesOpened: number;
    issuesClosed: number;
    prOpened: number;
    prMerged: number;
    prClosed: number;
  }[];
  openIssues: number | null;
}

export interface CommunityProfileInput {
  healthPercentage: number;
  hasReadme: boolean;
  hasLicense: boolean;
  hasContributing: boolean;
  hasCodeOfConduct: boolean;
  hasIssueTemplate: boolean;
  hasPullRequestTemplate: boolean;
  hasDescription: boolean;
}

export interface OverviewResult {
  languages: { language: string; bytes: number }[];
  releases: {
    tagName: string;
    name: string | null;
    publishedAt: string | null;
    isPrerelease: boolean;
  }[];
  community: CommunityProfileInput | null;
}

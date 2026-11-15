export type DataMode = 'live' | 'demo';

export type InsightLevel = 'good' | 'info' | 'warn' | 'critical';

export interface Insight {
  level: InsightLevel;
  title: string;
  detail: string;
  metric?: string;
}

export interface RepoSummary {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  htmlUrl: string | null;
  defaultBranch: string | null;
  language: string | null;
  topics: string[];
  isPrivate: boolean;
  isArchived: boolean;
  enabled: boolean;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  pushedAt: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

export interface TrafficPoint {
  date: string;
  views: number;
  uniqueVisitors: number;
  clones: number;
  uniqueCloners: number;
}

export interface TrafficTotals {
  views: number;
  uniqueVisitors: number;
  clones: number;
  uniqueCloners: number;
}

export interface TrafficReferrerRow {
  referrer: string;
  count: number;
  uniques: number;
}

export interface TrafficPathRow {
  path: string;
  title: string | null;
  count: number;
  uniques: number;
}

export interface CommitPoint { date: string; count: number; }

export interface ParticipationWeekRow {
  weekStart: string;
  commits: number;
  additions: number;
  deletions: number;
}

export interface ContributorRow {
  login: string;
  avatarUrl: string | null;
  contributions: number;
  type: string;
}

export interface IssuePrPoint {
  date: string;
  issuesOpened: number;
  issuesClosed: number;
  prOpened: number;
  prMerged: number;
  prClosed: number;
}

export interface StatPoint {
  date: string;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
}

export interface LanguageShare {
  language: string;
  bytes: number;
  percent: number;
}

export interface ReleaseRow {
  tagName: string;
  name: string | null;
  publishedAt: string | null;
  isPrerelease: boolean;
}

export interface CommunityChecklistItem {
  key: 'readme' | 'license' | 'contributing' | 'codeOfConduct' | 'issueTemplate' | 'pullRequestTemplate' | 'description';
  label: string;
  ok: boolean;
}

export interface CommunityInfo {
  healthPercentage: number;
  checklist: CommunityChecklistItem[];
}

export interface RepoMetrics {
  repo: RepoSummary;
  mode: DataMode;
  range: { days: number; from: string; to: string };
  traffic: {
    totals: TrafficTotals;
    previousTotals: TrafficTotals;
    daily: TrafficPoint[];
    referrers: TrafficReferrerRow[];
    paths: TrafficPathRow[];
    cloneRate: number;
  };
  activity: {
    commits: CommitPoint[];
    totalCommits: number;
    avgCommitsPerDay: number;
    weekly: ParticipationWeekRow[];
    contributors: ContributorRow[];
    busiestWeekday: string | null;
  };
  issues: {
    daily: IssuePrPoint[];
    totals: { issuesOpened: number; issuesClosed: number; prOpened: number; prMerged: number; prClosed: number };
    openIssues: number;
    closeRate: number;
    mergeRate: number;
    staleOpenIssues: number;
  };
  overview: {
    stars: number;
    forks: number;
    watchers: number;
    openIssues: number;
    starDelta: number;
    statsTrend: StatPoint[];
    languages: LanguageShare[];
    releases: ReleaseRow[];
    releaseCadenceDays: number | null;
    community: CommunityInfo | null;
  };
  healthScore: number;
  insights: Insight[];
}

export interface RepoRankRow {
  fullName: string;
  stars: number;
  starDelta: number;
  views: number;
  clones: number;
  cloneRate: number;
  commits: number;
  prMerged: number;
  mergeRate: number;
  openIssues: number;
  healthScore: number;
}

export interface AggregateMetrics {
  mode: DataMode;
  range: { days: number; from: string; to: string };
  overall: {
    repos: number;
    views: number;
    uniqueVisitors: number;
    clones: number;
    cloneRate: number;
    commits: number;
    stars: number;
    starDelta: number;
    openIssues: number;
    prMerged: number;
    issuesClosed: number;
    contributors: number;
    healthScore: number;
  };
  previous: { views: number; clones: number; commits: number; stars: number };
  trend: { date: string; views: number; clones: number; commits: number }[];
  perRepo: RepoRankRow[];
  languageMix: LanguageShare[];
  insights: Insight[];
}

export interface SyncRunRow {
  id: number;
  repoId: number | null;
  repoFullName: string | null;
  scope: string;
  status: 'running' | 'success' | 'partial' | 'error';
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  recordsWritten: number;
  mode: DataMode;
  error: string | null;
}

export interface HealthPayload {
  ok: boolean;
  version: string;
  mode: DataMode;
  tokenConfigured: boolean;
  tokenSource: 'env' | 'none';
  tokenSourceDetail?: 'env' | 'gh-cli' | 'none';
  repoCount: number;
  enabledRepoCount: number;
  lastSyncAt: string | null;
  dbPath: string;
  rateLimit?: { remaining: number; limit: number; resetAt: string } | null;
}

export interface ApiError { error: string; detail?: string; }

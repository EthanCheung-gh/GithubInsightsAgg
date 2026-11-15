import { addDaysKey, rangeKeys, todayKey } from './date';
import {
  replaceContributors,
  replaceIssuePrDaily,
  replaceLanguages,
  replaceParticipationWeeks,
  replaceReleases,
  replaceTrafficPaths,
  replaceTrafficReferrers,
  upsertCommitDays,
  upsertCommunityProfile,
  upsertStatSnapshot,
  upsertTrafficDaily,
} from './sync-store';
import type { RepoSummary } from './types';

/**
 * 确定性演示数据（增补 A1/A3）。
 *
 * 演示模式不是「读取时替换」，而是在同步阶段把合成数据写进同一批真实表：
 * `metrics-store` / `analytics` / 页面完全不需要区分模式。
 *
 * 全部随机性来自 `mulberry32(hash32(fullName + 盐))`，**绝不使用 Math.random()**，
 * 因此同一仓库任意次生成的结果完全一致（含各表行数）。
 * 唯一的「时间锚点」是 `todayKey()`（天粒度），同一天内重跑不会漂移。
 */

export const DEMO_REPOS: {
  owner: string;
  name: string;
  description: string;
  language: string;
  topics: string[];
}[] = [
  {
    owner: 'demo',
    name: 'aurora-ui',
    description: 'A component library with themable design tokens and accessible primitives.',
    language: 'TypeScript',
    topics: ['react', 'design-system', 'components', 'accessibility'],
  },
  {
    owner: 'demo',
    name: 'nebula-api',
    description: 'Streaming analytics API with pluggable storage backends.',
    language: 'Go',
    topics: ['go', 'api', 'analytics', 'postgres'],
  },
  {
    owner: 'demo',
    name: 'quanta-cli',
    description: 'A tiny CLI for running deterministic benchmarks.',
    language: 'Rust',
    topics: ['rust', 'cli', 'benchmark'],
  },
];

/* ------------------------------------------------------------------ */
/* 确定性伪随机源                                                       */
/* ------------------------------------------------------------------ */

/** FNV-1a 32bit：字符串 -> 种子。 */
function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32：输出 [0, 1) 的确定性序列。 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function keyOf(fullName: string): string {
  return fullName.trim().toLowerCase();
}

function streamFor(fullName: string, salt: string): () => number {
  return mulberry32(hash32(`${keyOf(fullName)}#${salt}`));
}

function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
}

function isWeekend(dateKey: string): boolean {
  const day = weekdayOf(dateKey);
  return day === 0 || day === 6;
}

/** 在 base 上下浮动 ±spread/2 取整。 */
function jitter(rng: () => number, base: number, spread = 0.12): number {
  const factor = 1 - spread / 2 + rng() * spread;
  return Math.max(0, Math.round(base * factor));
}

/** 取给定日期所在周的周一（UTC）。 */
function mondayOf(dateKey: string): string {
  return addDaysKey(dateKey, -((weekdayOf(dateKey) + 6) % 7));
}

/* ------------------------------------------------------------------ */
/* 规模档位                                                            */
/* ------------------------------------------------------------------ */

interface DemoScale {
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  viewsPerDay: number;
  clonesPerDay: number;
  weekdayCommits: number;
  weekendCommits: number;
  contributors: number;
  releases: number;
  issuesPerDay: number;
  prPerDay: number;
  health: number;
  languages: { language: string; bytes: number }[];
}

/** 三档规模：大流量高活跃 / 中等 / 冷清，保证排行榜与对比页有区分度。 */
const SCALES: DemoScale[] = [
  {
    stars: 4_320,
    forks: 618,
    watchers: 187,
    openIssues: 46,
    viewsPerDay: 470,
    clonesPerDay: 46,
    weekdayCommits: 9,
    weekendCommits: 2.2,
    contributors: 12,
    releases: 8,
    issuesPerDay: 1.2,
    prPerDay: 1.6,
    health: 100,
    languages: [
      { language: 'TypeScript', bytes: 1_482_311 },
      { language: 'CSS', bytes: 268_940 },
      { language: 'JavaScript', bytes: 121_540 },
      { language: 'Shell', bytes: 21_883 },
    ],
  },
  {
    stars: 764,
    forks: 97,
    watchers: 39,
    openIssues: 17,
    viewsPerDay: 128,
    clonesPerDay: 15,
    weekdayCommits: 3,
    weekendCommits: 0.6,
    contributors: 7,
    releases: 5,
    issuesPerDay: 0.4,
    prPerDay: 0.55,
    health: 87,
    languages: [
      { language: 'Go', bytes: 431_905 },
      { language: 'SQL', bytes: 28_470 },
      { language: 'Dockerfile', bytes: 9_812 },
      { language: 'Makefile', bytes: 4_120 },
    ],
  },
  {
    stars: 96,
    forks: 9,
    watchers: 5,
    openIssues: 3,
    viewsPerDay: 13,
    clonesPerDay: 2,
    weekdayCommits: 0.6,
    weekendCommits: 0.1,
    contributors: 5,
    releases: 3,
    issuesPerDay: 0.28,
    prPerDay: 0.34,
    health: 62,
    languages: [
      { language: 'Rust', bytes: 96_420 },
      { language: 'Shell', bytes: 5_310 },
      { language: 'Nix', bytes: 2_040 },
    ],
  },
];

function scaleFor(fullName: string): DemoScale {
  const key = keyOf(fullName);
  const index = DEMO_REPOS.findIndex((item) => `${item.owner}/${item.name}` === key);
  if (index >= 0) return SCALES[index] ?? SCALES[1];
  // 未知仓库：由名字派生一档介于「中等」和「冷清」之间的规模，仍然完全确定。
  const rng = streamFor(fullName, 'scale');
  const stars = 60 + Math.floor(rng() * 640);
  return {
    stars,
    forks: Math.round(stars * 0.14),
    watchers: Math.round(stars * 0.05),
    openIssues: Math.floor(rng() * 12),
    viewsPerDay: 10 + Math.floor(rng() * 90),
    clonesPerDay: 2 + Math.floor(rng() * 12),
    weekdayCommits: 0.8 + rng() * 2,
    weekendCommits: 0.2 + rng() * 0.5,
    contributors: 5 + Math.floor(rng() * 8),
    releases: 3 + Math.floor(rng() * 4),
    issuesPerDay: 0.1 + rng() * 0.5,
    prPerDay: 0.1 + rng() * 0.7,
    health: 60 + Math.floor(rng() * 40),
    languages: [
      { language: 'TypeScript', bytes: 120_000 + Math.floor(rng() * 180_000) },
      { language: 'JavaScript', bytes: 30_000 + Math.floor(rng() * 50_000) },
      { language: 'CSS', bytes: 8_000 + Math.floor(rng() * 20_000) },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* 基础信息                                                            */
/* ------------------------------------------------------------------ */

export function demoBasics(fullName: string): {
  description: string;
  htmlUrl: string;
  defaultBranch: string;
  language: string;
  topics: string[];
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  pushedAt: string;
  isPrivate: boolean;
  isArchived: boolean;
} {
  const trimmed = fullName.trim();
  const key = keyOf(trimmed);
  const meta = DEMO_REPOS.find((item) => `${item.owner}/${item.name}` === key);
  const scale = scaleFor(trimmed);
  const rng = streamFor(trimmed, 'basics');

  const stars = jitter(rng, scale.stars, 0.08);
  const forks = jitter(rng, scale.forks, 0.12);
  const watchers = jitter(rng, scale.watchers, 0.14);
  const openIssues = jitter(rng, scale.openIssues, 0.25);

  // 时间锚点取「今天往前 0~2 天的固定整点」，同一天内多次调用结果一致。
  const daysAgo = Math.floor(rng() * 3);
  const hour = 6 + Math.floor(rng() * 12);
  const pushedAt = new Date(`${addDaysKey(todayKey(), -daysAgo)}T${String(hour).padStart(2, '0')}:17:00.000Z`).toISOString();

  return {
    description: meta?.description ?? `${scale.languages[0]?.language ?? 'TypeScript'} 演示仓库`,
    htmlUrl: `https://github.com/${trimmed}`,
    defaultBranch: 'main',
    language: meta?.language ?? scale.languages[0]?.language ?? 'TypeScript',
    topics: meta ? [...meta.topics] : ['demo', 'sample'],
    stars,
    forks,
    watchers,
    openIssues,
    pushedAt,
    isPrivate: false,
    isArchived: false,
  };
}

/* ------------------------------------------------------------------ */
/* 各表合成                                                            */
/* ------------------------------------------------------------------ */

const TRAFFIC_WINDOW_DAYS = 60;
const COMMIT_WINDOW_DAYS = 180;
const PARTICIPATION_WINDOW_WEEKS = 26;
const ISSUE_PR_WINDOW_DAYS = 60;
const SNAPSHOT_WINDOW_DAYS = 60;

const REFERRER_MIX: { referrer: string; share: number }[] = [
  { referrer: 'github.com', share: 0.41 },
  { referrer: 'Google', share: 0.22 },
  { referrer: '直接访问', share: 0.16 },
  { referrer: 'news.ycombinator.com', share: 0.09 },
  { referrer: 'reddit.com', share: 0.06 },
  { referrer: 'dev.to', share: 0.045 },
];

const PATH_MIX: { path: string; title: string | null; share: number }[] = [
  { path: '/blob/main/README.md', title: 'README.md', share: 0.13 },
  { path: '/issues', title: 'Issues', share: 0.14 },
  { path: '/pulls', title: 'Pull requests', share: 0.1 },
  { path: '/releases', title: 'Releases', share: 0.06 },
  { path: '/graphs/traffic', title: 'Traffic', share: 0.04 },
  { path: '/blob/main/docs/getting-started.md', title: 'getting-started.md', share: 0.035 },
];

/** 首页路径的 title 形如 `owner/name: <description>`（与 GitHub Traffic 页面一致）。 */
const ROOT_PATH_SHARE = 0.44;

const CONTRIBUTOR_POOL = [
  'linus',
  'ada',
  'grace',
  'alan',
  'margaret',
  'donald',
  'barbara',
  'ken',
  'frances',
  'edsger',
  'leslie',
  'radia',
  'anita',
  'bjarne',
];

function avatarFor(login: string): string {
  // 纯计算结果，不发请求；用 login 派生稳定的头像 id。
  const id = 1_000 + (hash32(login) % 90_000);
  return `https://avatars.githubusercontent.com/u/${id}?v=4`;
}

/** 交错洗牌的确定性取样：从池子里取 count 个 login。 */
function pickLogins(rng: () => number, count: number): string[] {
  const pool = [...CONTRIBUTOR_POOL];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, Math.max(1, Math.min(count, pool.length)));
}

/**
 * 把一个仓库的全部合成数据写入 DB，返回写入行数。
 * 覆盖 A3 要求的 11 张表；窗口：traffic 60 天、commit 180 天、参与度 26 周、
 * Issue/PR 60 天（含 0 值日期）、快照 60 天。
 */
export function seedDemoRepoData(repo: RepoSummary, days: number): number {
  const fullName = repo.fullName;
  const scale = scaleFor(fullName);
  const basics = demoBasics(fullName);
  const repoId = repo.id;
  const today = todayKey();

  const requested = Number.isFinite(days) ? Math.max(7, Math.min(90, Math.trunc(days))) : 30;
  const trafficWindow = Math.max(TRAFFIC_WINDOW_DAYS, requested);
  const issueWindow = Math.max(ISSUE_PR_WINDOW_DAYS, requested);

  const anchor = {
    stars: repo.stars > 0 ? repo.stars : basics.stars,
    forks: repo.forks > 0 ? repo.forks : basics.forks,
    watchers: repo.watchers > 0 ? repo.watchers : basics.watchers,
    openIssues: repo.openIssues > 0 ? repo.openIssues : basics.openIssues,
  };

  let written = 0;

  /* ---------------- traffic_daily：缓慢上升 + 周末回落 + 一次突刺 ---------------- */
  const trafficRng = streamFor(fullName, 'traffic');
  const trafficKeys = rangeKeys(trafficWindow, today);
  const spikeOffset = 5 + Math.floor(trafficRng() * Math.max(1, trafficWindow - 12));
  const trafficRows = trafficKeys.map((date, index) => {
    const progress = trafficKeys.length > 1 ? index / (trafficKeys.length - 1) : 1;
    const trend = 0.72 + progress * 0.52;
    const weekendFactor = isWeekend(date) ? 0.56 : 1;
    const noise = 0.84 + trafficRng() * 0.34;
    const spike = index === spikeOffset ? 2.6 : 1;
    const views = Math.round(scale.viewsPerDay * trend * weekendFactor * noise * spike);
    const uniqueVisitors = Math.max(0, Math.round(views * (0.48 + trafficRng() * 0.16)));
    const clonesRaw = scale.clonesPerDay * trend * (isWeekend(date) ? 0.42 : 1) * (0.72 + trafficRng() * 0.56);
    const clones = Math.max(0, Math.round(clonesRaw * spike));
    const uniqueCloners = Math.max(0, Math.round(clones * (0.52 + trafficRng() * 0.2)));
    return { date, views, uniqueVisitors, clones, uniqueCloners };
  });
  written += upsertTrafficDaily(repoId, trafficRows);

  /* ---------------- traffic_referrers / traffic_paths（当天快照） ---------------- */
  const capturedAt = today;
  const recentViews = trafficRows
    .slice(-14)
    .reduce((acc, row) => acc + row.views, 0);

  const referrerRng = streamFor(fullName, 'referrers');
  written += replaceTrafficReferrers(
    repoId,
    capturedAt,
    REFERRER_MIX.map((item) => {
      const count = Math.round(recentViews * item.share * (0.9 + referrerRng() * 0.2));
      return {
        referrer: item.referrer,
        count,
        uniques: Math.max(0, Math.round(count * (0.55 + referrerRng() * 0.2))),
      };
    }),
  );

  const pathRng = streamFor(fullName, 'paths');
  const pathRows = [
    {
      path: '/',
      title: `${fullName}: ${basics.description.slice(0, 48)}`,
      share: ROOT_PATH_SHARE,
    },
    ...PATH_MIX,
  ];
  written += replaceTrafficPaths(
    repoId,
    capturedAt,
    pathRows.map((item) => {
      const count = Math.round(recentViews * item.share * (0.85 + pathRng() * 0.3));
      return {
        path: item.path,
        title: item.title,
        count,
        uniques: Math.max(0, Math.round(count * (0.58 + pathRng() * 0.18))),
      };
    }),
  );

  /* ---------------- commit_days：工作日多、周末低 ---------------- */
  const commitRng = streamFor(fullName, 'commits');
  const commitKeys = rangeKeys(COMMIT_WINDOW_DAYS, today);
  const commitRows = commitKeys.map((date) => {
    const base = isWeekend(date) ? scale.weekendCommits : scale.weekdayCommits;
    const seasonal = 0.72 + commitRng() * 0.6;
    const count = Math.max(0, Math.round(base * seasonal));
    return { date, count };
  });
  written += upsertCommitDays(repoId, commitRows);

  /* ---------------- participation_weeks：最近 26 周 ---------------- */
  const weekRng = streamFor(fullName, 'weeks');
  const currentMonday = mondayOf(today);
  const commitsByDate = new Map(commitRows.map((row) => [row.date, row.count]));
  const weekRows: {
    weekStart: string;
    commits: number;
    additions: number;
    deletions: number;
  }[] = [];
  for (let i = PARTICIPATION_WINDOW_WEEKS - 1; i >= 0; i -= 1) {
    const weekStart = addDaysKey(currentMonday, -i * 7);
    let commits = 0;
    for (let d = 0; d < 7; d += 1) {
      commits += commitsByDate.get(addDaysKey(weekStart, d)) ?? 0;
    }
    weekRows.push({
      weekStart,
      commits,
      additions: Math.round(commits * (42 + weekRng() * 44)),
      deletions: Math.round(commits * (16 + weekRng() * 32)),
    });
  }
  written += replaceParticipationWeeks(repoId, weekRows);

  /* ---------------- contributors ---------------- */
  const contributorRng = streamFor(fullName, 'contributors');
  const logins = pickLogins(contributorRng, scale.contributors);
  const topContributions = Math.max(12, Math.round(scale.weekdayCommits * 46 + 18));
  written += replaceContributors(
    repoId,
    capturedAt,
    logins.map((login, index) => ({
      login,
      avatarUrl: avatarFor(login),
      contributions: Math.max(
        1,
        Math.round(topContributions * Math.pow(0.66, index) * (0.9 + contributorRng() * 0.2)),
      ),
      type: 'User',
    })),
  );

  /* ---------------- issue_pr_daily：含 0 值日期 ---------------- */
  const issueRng = streamFor(fullName, 'issues');
  const issueKeys = rangeKeys(issueWindow, today);
  written += replaceIssuePrDaily(
    repoId,
    issueKeys.map((date) => {
      const damp = isWeekend(date) ? 0.25 : 1;
      const issuesOpened = Math.max(0, Math.round(scale.issuesPerDay * damp * (0.6 + issueRng() * 0.9)));
      const prOpened = Math.max(0, Math.round(scale.prPerDay * damp * (0.6 + issueRng() * 0.9)));
      // 关闭但未合并的 PR 单独计一档，且保证 merged + closed 不超过当日新开数
      const prClosed = prOpened > 0 && issueRng() < 0.18 ? 1 : 0;
      const prMerged = Math.max(
        0,
        Math.min(prOpened - prClosed, Math.round(prOpened * (0.55 + issueRng() * 0.35))),
      );
      return {
        date,
        issuesOpened,
        issuesClosed: Math.max(0, Math.round(issuesOpened * (0.5 + issueRng() * 0.5))),
        prOpened,
        prMerged,
        prClosed,
      };
    }),
  );

  /* ---------------- releases ---------------- */
  const releaseRng = streamFor(fullName, 'releases');
  const releaseCount = Math.max(3, Math.min(8, scale.releases));
  const shortName = fullName.split('/')[1] ?? 'release';
  // 从最新版本倒序构造：tag 号越大，发布日期越新（releaseCadenceDays 依赖这个顺序）
  const releases: {
    tagName: string;
    name: string;
    publishedAt: string;
    isPrerelease: boolean;
  }[] = [];
  let cursorDays = 12 + Math.round(releaseRng() * 18);
  for (let index = releaseCount - 1; index >= 0; index -= 1) {
    releases.push({
      tagName: `v1.${index}.0`,
      name: `${shortName} v1.${index}.0`,
      publishedAt: new Date(`${addDaysKey(today, -cursorDays)}T12:00:00.000Z`).toISOString(),
      isPrerelease: index === releaseCount - 1 && releaseRng() > 0.7,
    });
    cursorDays += 18 + Math.round(releaseRng() * 24);
  }
  written += replaceReleases(repoId, releases);

  /* ---------------- repo_languages ---------------- */
  const languageRng = streamFor(fullName, 'languages');
  written += replaceLanguages(
    repoId,
    scale.languages.map((item) => ({
      language: item.language,
      bytes: Math.max(1, Math.round(item.bytes * (0.92 + languageRng() * 0.16))),
    })),
  );

  /* ---------------- community_profiles ---------------- */
  written += upsertCommunityProfile(repoId, capturedAt, {
    healthPercentage: scale.health,
    hasReadme: true,
    hasLicense: true,
    hasContributing: scale.health >= 85,
    hasCodeOfConduct: scale.health >= 95,
    hasIssueTemplate: scale.health >= 70,
    hasPullRequestTemplate: scale.health >= 90,
    hasDescription: true,
  });

  /* ---------------- repo_stat_snapshots：收敛到今天的基础信息 ---------------- */
  const snapshotRng = streamFor(fullName, 'snapshots');
  const snapshotKeys = rangeKeys(SNAPSHOT_WINDOW_DAYS, today);
  const starGrowth = Math.max(1, Math.round(anchor.stars * 0.07));
  const forkGrowth = Math.max(1, Math.round(anchor.forks * 0.05));
  for (let i = 0; i < snapshotKeys.length; i += 1) {
    const remaining = snapshotKeys.length - 1 - i;
    const ratio = snapshotKeys.length > 1 ? remaining / (snapshotKeys.length - 1) : 0;
    const noise = Math.floor(snapshotRng() * 2);
    written += upsertStatSnapshot(repoId, snapshotKeys[i], {
      // 今天这条必须与 repos.stars 对齐（starDelta 依赖区间末快照）
      stars: Math.max(0, anchor.stars - Math.round(starGrowth * ratio) - (remaining === 0 ? 0 : noise)),
      forks: Math.max(0, anchor.forks - Math.round(forkGrowth * ratio)),
      watchers: anchor.watchers,
      openIssues: anchor.openIssues,
    });
  }

  return written;
}

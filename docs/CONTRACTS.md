# GithubInsightsAgg — 工程契约 (v1)

> 本文件是并行开发的唯一事实来源。所有实现必须严格符合此处的类型、路由、表结构与组件 API。
> 若发现契约有缺陷，**不要自行改契约**：在 `docs/CONTRACTS-ISSUES.md` 追加一条记录并在交付说明中提出。

## 1. 技术栈（版本已核实可用，禁止替换）

| 项 | 版本 |
| --- | --- |
| next | 16.4.6 |
| react / react-dom | 19.3.1 |
| typescript | ^5.9 |
| tailwindcss + @tailwindcss/postcss | 4.3.5 |
| echarts | 6.1.0 |
| lucide-react | 1.73.0 |
| zod | 4.6.7 |
| clsx | ^2 |
| tsx (devDep) | ^4 |

- 持久化：**Node 内置 `node:sqlite`**（`DatabaseSync`）。禁止引入 prisma / better-sqlite3 / drizzle。
- 包管理：pnpm。禁止引入未列出的运行时依赖（如需要先记录到 CONTRACTS-ISSUES.md）。
- 全部 route handler 与数据访问使用 Node runtime（不要写 `export const runtime = 'edge'`）。

## 2. 环境变量

```
DATABASE_URL="file:./data/insights.db"   # 相对仓库根；目录不存在时自动创建
GITHUB_TOKEN=""                          # 可选，空则回退应用内保存的 Token / gh auth token，再回退演示数据
GITHUB_MIN_INTERVAL_MS="80"              # 采集节流，默认 80ms
GITHUB_OAUTH_CLIENT_ID=""                # 可选，OAuth App 的 Client ID，用于应用内 Device Flow 一键授权
```

- Token 只在服务端读取，`NEXT_PUBLIC_*` 绝不承载 Token。
- 未获得 Token 时 `mode = 'demo'`，一切 UI 与 API 必须照常工作，数据由 `src/lib/demo.ts` 确定性生成。
- **Token 解析顺序**（`resolveToken()`，`src/lib/github/client.ts` 唯一实现）：

  ```
  GITHUB_TOKEN / GH_TOKEN（source = 'env'）
    → 应用内保存：app_settings.github_token（source = 'stored'）
    → gh auth token（source = 'gh-cli'）
    → 无（source = 'none'，mode = 'demo'）
  ```

  前两者每次现读，写入后立即生效；`gh auth token` 的结果在进程内缓存，设置/清除 Token 后由 `resetTokenCaches()` 失效重试。
- `GITHUB_OAUTH_CLIENT_ID`：OAuth App 的 Client ID，用于应用内「一键连接 GitHub」（Device Flow）。**只需 Client ID，不需要 Client Secret**。未配置时 `deviceFlowAvailable = false`，设置页自动降级为「手动填写 Token」。
- **Token 存储与安全**：应用内保存的 Token 以**明文**存放在本地 SQLite 的 `app_settings` 表，仅服务端可读；任何 HTTP 响应只返回 `maskToken()` 之后的掩码（如 `ghp_…mnop`），日志与错误信息中不得出现明文。共享机器 / 多人环境建议改用环境变量，并且不要把 `data/` 目录共享出去。

## 3. 文件归属（写权限边界，严禁跨界写文件）

| 编号 | 负责范围 |
| --- | --- |
| WP1 | `package.json` `tsconfig.json` `next.config.ts` `postcss.config.mjs` `.env.example` `.gitignore` `db/schema.sql` `scripts/db-migrate.ts` `src/lib/types.ts` `src/lib/db.ts` `src/lib/repo-store.ts` `src/lib/date.ts` `src/lib/config.ts` |
| WP2 | `src/lib/github/**` `src/lib/sync.ts` `src/lib/sync-store.ts` `src/app/api/health/route.ts` `src/app/api/sync/route.ts` |
| WP3 | `src/lib/demo.ts` `src/lib/metrics-store.ts` `src/lib/analytics.ts` `src/lib/insights.ts` `src/app/api/repos/**` `src/app/api/metrics/**` `src/app/api/aggregate/route.ts` |
| WP4 | `src/app/globals.css` `src/app/layout.tsx` `src/components/ui/**` `src/components/layout/**` `src/components/charts/**` `src/lib/format.ts` `src/lib/client-api.ts` |
| WP5 | `src/app/page.tsx` `src/app/repos/page.tsx` `src/app/settings/page.tsx` `src/components/dashboard/**` |
| WP6 | `src/app/repos/[owner]/[repo]/**` `src/app/compare/**` `src/components/metrics/**` |
| WP7 | `README.md` `scripts/smoke.ts` `scripts/sync-cli.ts` |

只读引用他人文件是允许且必要的。`src/lib/types.ts` 由 WP1 落地，任何人不得修改，只能引用。

## 4. 数据库表结构（`db/schema.sql` 全文，WP1 逐字落地）

当前 schema 共 **14 张表**：`repos` `repo_stat_snapshots` `traffic_daily` `traffic_referrers` `traffic_paths`
`contributors` `commit_days` `participation_weeks` `issue_pr_daily` `releases` `repo_languages`
`community_profiles` `sync_runs` `app_settings`。

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS repos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner           TEXT NOT NULL,
  name            TEXT NOT NULL,
  full_name       TEXT NOT NULL UNIQUE,
  description     TEXT,
  html_url        TEXT,
  default_branch  TEXT,
  language        TEXT,
  topics          TEXT,                -- JSON 字符串数组
  is_private      INTEGER NOT NULL DEFAULT 0,
  is_archived     INTEGER NOT NULL DEFAULT 0,
  enabled         INTEGER NOT NULL DEFAULT 1,
  stars           INTEGER NOT NULL DEFAULT 0,
  forks           INTEGER NOT NULL DEFAULT 0,
  watchers        INTEGER NOT NULL DEFAULT 0,
  open_issues     INTEGER NOT NULL DEFAULT 0,
  pushed_at       TEXT,
  created_at      TEXT NOT NULL,
  last_synced_at  TEXT,
  last_sync_error TEXT
);

CREATE TABLE IF NOT EXISTS repo_stat_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id     INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,           -- YYYY-MM-DD (UTC)
  stars       INTEGER NOT NULL DEFAULT 0,
  forks       INTEGER NOT NULL DEFAULT 0,
  watchers    INTEGER NOT NULL DEFAULT 0,
  open_issues INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, date)
);

CREATE TABLE IF NOT EXISTS traffic_daily (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id         INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  date            TEXT NOT NULL,
  views           INTEGER NOT NULL DEFAULT 0,
  unique_visitors INTEGER NOT NULL DEFAULT 0,
  clones          INTEGER NOT NULL DEFAULT 0,
  unique_cloners  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, date)
);

CREATE TABLE IF NOT EXISTS traffic_referrers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id     INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,           -- YYYY-MM-DD
  referrer    TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  uniques     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, captured_at, referrer)
);

CREATE TABLE IF NOT EXISTS traffic_paths (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id     INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  path        TEXT NOT NULL,
  title       TEXT,
  count       INTEGER NOT NULL DEFAULT 0,
  uniques     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, captured_at, path)
);

CREATE TABLE IF NOT EXISTS contributors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id       INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  login         TEXT NOT NULL,
  avatar_url    TEXT,
  contributions INTEGER NOT NULL DEFAULT 0,
  type          TEXT NOT NULL DEFAULT 'User',
  captured_at   TEXT NOT NULL,
  UNIQUE (repo_id, login)
);

CREATE TABLE IF NOT EXISTS commit_days (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  date    TEXT NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, date)
);

CREATE TABLE IF NOT EXISTS participation_weeks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id    INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  commits    INTEGER NOT NULL DEFAULT 0,
  additions  INTEGER NOT NULL DEFAULT 0,
  deletions  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, week_start)
);

CREATE TABLE IF NOT EXISTS issue_pr_daily (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id       INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,
  issues_opened INTEGER NOT NULL DEFAULT 0,
  issues_closed INTEGER NOT NULL DEFAULT 0,
  pr_opened     INTEGER NOT NULL DEFAULT 0,
  pr_merged     INTEGER NOT NULL DEFAULT 0,
  pr_closed     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, date)
);

CREATE TABLE IF NOT EXISTS releases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id       INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  tag_name      TEXT NOT NULL,
  name          TEXT,
  published_at  TEXT,
  is_prerelease INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, tag_name)
);

CREATE TABLE IF NOT EXISTS repo_languages (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id  INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  bytes    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, language)
);

CREATE TABLE IF NOT EXISTS community_profiles (
  repo_id                  INTEGER PRIMARY KEY REFERENCES repos(id) ON DELETE CASCADE,
  health_percentage        INTEGER NOT NULL DEFAULT 0,
  has_readme               INTEGER NOT NULL DEFAULT 0,
  has_license              INTEGER NOT NULL DEFAULT 0,
  has_contributing         INTEGER NOT NULL DEFAULT 0,
  has_code_of_conduct      INTEGER NOT NULL DEFAULT 0,
  has_issue_template       INTEGER NOT NULL DEFAULT 0,
  has_pull_request_template INTEGER NOT NULL DEFAULT 0,
  has_description          INTEGER NOT NULL DEFAULT 0,
  captured_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id         INTEGER,
  scope           TEXT NOT NULL,       -- 'repo' | 'all'
  status          TEXT NOT NULL,       -- 'running' | 'success' | 'partial' | 'error'
  trigger         TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'cli' | 'api'
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  duration_ms     INTEGER,
  records_written INTEGER NOT NULL DEFAULT 0,
  mode            TEXT NOT NULL DEFAULT 'live',   -- 'live' | 'demo'
  error           TEXT
);

-- 应用级键值设置（如应用内获取/手动填写的 GitHub Token）。
-- 幂等新增，不影响上面 13 张已有表及其数据。
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## 5. 共享 TypeScript 类型（`src/lib/types.ts`，WP1 逐字落地）

所有日期对外一律 `YYYY-MM-DD` 字符串（UTC）。所有比例字段为 `0~1` 的小数，百分比格式化在前端做。

```ts
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
  tokenSourceDetail?: 'env' | 'stored' | 'gh-cli' | 'none'; // 增补 A4 / A5：Token 的确切来源（含应用内保存）
  repoCount: number;
  enabledRepoCount: number;
  lastSyncAt: string | null;
  dbPath: string;
  rateLimit?: { remaining: number; limit: number; resetAt: string } | null;
}

export interface ApiError { error: string; detail?: string; }
```

## 6. HTTP API 契约

统一：成功 `200` + JSON；参数错误 `400`；不存在 `404`；服务端异常 `500` + `{ error, detail? }`。
所有 handler 使用 `NextRequest`/`NextResponse`。

### `GET /api/health`
→ `HealthPayload`

### `GET /api/repos`
→ `{ repos: RepoSummary[] }`（按 `stars` 降序）

### `POST /api/repos`
请求体 `{ "fullName": "owner/name" }`（也接受 `{ owner, name }`）
- 校验 owner/name 只含 `[A-Za-z0-9_.-]`
- 已存在 → `409 { error: 'repo_exists' }`
- live 模式：调用 GitHub 拉取基础信息后入库；失败 → `400 { error: 'repo_not_found' }`
- demo 模式：直接生成一条演示仓库
→ `201 { repo: RepoSummary, mode: DataMode }`

### `PATCH /api/repos/:id`
请求体 `{ enabled: boolean }`（必填且必须是布尔值，否则 400 `invalid_body`）→ `{ repo: RepoSummary }`

### `DELETE /api/repos/:id`
→ `{ ok: true }`（级联删除所有关联数据）

### `POST /api/sync`
请求体 `{ fullName?: string, days?: number }`（`days` 默认 30，允许 7~90）
- 省略 `fullName` → 同步所有 `enabled` 仓库
→ `{ runs: SyncRunRow[], mode: DataMode }`

### `GET /api/sync?limit=20`
→ `{ runs: SyncRunRow[], mode: DataMode }`

### `GET /api/metrics/:owner/:repo?days=30`
→ `{ data: RepoMetrics }`；仓库未入库 → `404 { error: 'repo_not_found' }`
若该仓库从未同步（无任何数据）也会返回结构完整的零值指标，不报错。

### `GET /api/aggregate?days=30&repos=owner/a,owner/b`
- `repos` 省略 → 全部 `enabled` 仓库；空结果时 `overall.repos = 0`
→ `{ data: AggregateMetrics }`

### Token 管理（应用内获取 / 粘贴 / 清除）

四个 handler 全部 `runtime = 'nodejs'` + `dynamic = 'force-dynamic'`，所有响应只出现掩码（`maskToken()`），
日志与错误信息不得出现 Token 明文。

#### `GET /api/auth/token`
→
```ts
{
  configured: boolean;
  source: 'env' | 'stored' | 'gh-cli' | 'none';
  sourceLabel: string;          // '环境变量' | '应用内保存' | 'gh CLI' | '未配置'
  maskedToken: string | null;
  canClear: boolean;            // 本地是否存在「应用内保存」的 Token（DB 读取失败时降级为 false）
  deviceFlowAvailable: boolean; // GITHUB_OAUTH_CLIENT_ID 是否已配置
  settingUrl: string;           // https://github.com/settings/tokens
  createTokenUrl: string;       // 已预填 scope=repo,read:org 的创建链接
}
```
只读：**不发起任何 GitHub 请求**（`resolveToken()` 仅读 env / SQLite / 本地 `gh auth token`）。
`canClear` 只看「库里有没有应用内保存的 Token」，与 `source` 无关（`env` 同时存在时为 `true`，见 `DELETE`）。

#### `POST /api/auth/token`
请求体 `{ "token": string }`
- 先用该 Token 调 GitHub `GET /user` 校验；通过后写入 `app_settings.github_token`，并 `resetTokenCaches()`
- `200 { ok: true, login, scopes: string[], maskedToken, source: 'stored' }`
- schema 校验失败 / GitHub 返回 401 → `400 { error: 'invalid_token', detail }`
- 其他异常（网络、5xx）→ `500 { error: 'internal_error', detail }`

#### `DELETE /api/auth/token`
分支顺序固定为**先清本地，清不到再按来源判定**（这样「库里存在 stored token」时，无论当前生效来源是什么都能清掉，与 `canClear` 一致）：
1. 删除 `app_settings.github_token` 成功 → `200 { ok: true }`（并 `resetTokenCaches()`）
2. 没清到任何东西，且 `resolveToken().source === 'env'` → `409 { error: 'token_from_env', detail }`
3. 没清到任何东西，其他来源 → `404 { error: 'no_stored_token' }`

#### `POST /api/auth/device`
发起 GitHub OAuth Device Flow（`scope = repo read:org`，只需 Client ID）
- `200 { deviceCode, userCode, verificationUri, expiresIn, interval }`
- 未配置 `GITHUB_OAUTH_CLIENT_ID` → `501 { error: 'device_flow_unavailable', detail }`
- GitHub 侧错误 → 透传其状态码（无法归类时 `502`）+ `{ error, detail }`

#### `GET /api/auth/device?deviceCode=xxx&interval=5`
参数：`deviceCode`（必填，长度 8~255）、`interval`（可选，整数 1~60，默认 5）——`interval` 是**调用方当前使用的轮询间隔**，
用于 `slow_down` 递增（见下）。参数校验走 `devicePollSchema`（`src/lib/validation.ts`）。

轮询一次授权状态。**除参数错误外一律 200**，客户端按 `state` 分发：
```ts
{ state: 'pending' }
{ state: 'slow_down'; interval: number }
{ state: 'success'; login: string; scopes: string[]; maskedToken: string; source: 'stored' }
{ state: 'error'; error: string; description: string }
```
- `success` 时服务端先 `validateToken()` 再落库（`app_settings.github_token`）并 `resetTokenCaches()`，响应只含掩码
- `deviceCode` 缺失或长度非法 → `400 { error: 'invalid_body', detail }`
- `interval` 非 1~60 的整数 → `400 { error: 'invalid_body', detail }`（中文说明）

`slow_down` 的新间隔 = `min(60, max(1, floor(interval ?? 5) + 5))`，若 GitHub 响应体自带更大的 `interval` 则取二者最大值后同样 clamp 到 **60 秒上限**。
GitHub 的 `slow_down` 响应体通常**不带** `interval`，所以调用方必须每次回传当前间隔，否则不会真正递增（10 → 15 → 20 …）。

客户端轮询约定（`TokenPanel`）：按 `interval` 秒轮询并把当前 `interval` 一起作为查询参数回传；`pending` 继续等待；
`slow_down` 用返回的新 `interval` 覆盖本地值后继续；倒计时（`expiresIn`）归零即判定过期；
取消或组件卸载必须清理定时器（`setInterval` / `setTimeout`）并 abort 在途请求。

## 7. 设计令牌（`globals.css`，WP4 落地；其他 WP 只使用类名与 CSS 变量）

暗色为默认主题，`html[data-theme='light']` 覆盖为亮色。必须提供的 CSS 变量：

```
--bg --bg-elevated --surface --surface-2 --border --border-strong
--text --text-muted --text-subtle
--accent --accent-soft --accent-contrast
--success --success-soft --warn --warn-soft --danger --danger-soft
--chart-1 --chart-2 --chart-3 --chart-4 --chart-5 --chart-6
--radius-sm --radius-md --radius-lg --shadow-card
```

通用类名（必须在 `@layer components` 或普通 CSS 中定义）：`.card` `.card-title` `.kpi-value` `.badge` `.badge--good` `.badge--warn` `.badge--danger` `.badge--info` `.btn` `.btn--primary` `.btn--ghost` `.input` `.table` `.skeleton` `.tabular`（数字等宽）`.scroll-thin`。

字体：正文系统字体栈；数字使用 `ui-monospace, "JetBrains Mono", monospace` 并 `font-variant-numeric: tabular-nums`。

## 8. UI 组件 API（WP4 实现，WP5/WP6 只消费）

`src/components/ui/`
```ts
// Card.tsx
export function Card(p: { title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; className?: string; bodyClassName?: string; children: React.ReactNode }): JSX.Element
// KpiCard.tsx
export function KpiCard(p: { label: string; value: React.ReactNode; delta?: number | null; deltaLabel?: string; hint?: string; icon?: React.ReactNode; tone?: 'neutral'|'good'|'warn'|'danger'; href?: string }): JSX.Element
// Badge.tsx
export function Badge(p: { tone?: 'neutral'|'good'|'warn'|'danger'|'info'; children: React.ReactNode; className?: string }): JSX.Element
// Button.tsx
export function Button(p: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary'|'ghost'|'danger'; size?: 'sm'|'md'; loading?: boolean }): JSX.Element
// Tabs.tsx  (受控，客户端组件)
export function Tabs(p: { tabs: { key: string; label: string; count?: number }[]; value: string; onChange: (k: string) => void }): JSX.Element
// DataTable.tsx
export interface Column<T> { key: string; header: React.ReactNode; render?: (row: T) => React.ReactNode; align?: 'left'|'right'; width?: string; sortValue?: (row: T) => number | string }
export function DataTable<T>(p: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; empty?: React.ReactNode; dense?: boolean; initialSortKey?: string; initialSortDir?: 'asc'|'desc' }): JSX.Element
// EmptyState.tsx
export function EmptyState(p: { title: string; description?: string; action?: React.ReactNode; icon?: React.ReactNode }): JSX.Element
// Skeleton.tsx
export function Skeleton(p: { className?: string }): JSX.Element
// ProgressBar.tsx
export function ProgressBar(p: { value: number; max?: number; tone?: 'accent'|'good'|'warn'|'danger'; label?: string }): JSX.Element
// ThemeToggle.tsx  (客户端)
export function ThemeToggle(): JSX.Element
// SyncButton.tsx  (客户端，触发 POST /api/sync 后 router.refresh())
export function SyncButton(p: { fullName?: string; label?: string; variant?: 'primary'|'ghost'; size?: 'sm'|'md' }): JSX.Element
// AddRepoForm.tsx (客户端，POST /api/repos，成功后 router.refresh())
export function AddRepoForm(p: { className?: string }): JSX.Element
```

`src/components/settings/`
```ts
// TokenPanel.tsx (客户端，设置页专用：Device Flow 一键授权 + 手动 Token + 清除)
export function TokenPanel(p: {
  initial: {
    configured: boolean;
    source: 'env' | 'stored' | 'gh-cli' | 'none';
    sourceLabel: string;
    maskedToken: string | null;
    canClear: boolean;
    deviceFlowAvailable: boolean;
    createTokenUrl: string;
    settingUrl: string;
  };
}): JSX.Element
```

`src/components/layout/`
```ts
export function AppShell(p: { children: React.ReactNode }): JSX.Element   // 侧边栏 + 顶栏 + 内容区
export function Sidebar(p: { active?: string }): JSX.Element
export function TopBar(p: { title: string; subtitle?: string; actions?: React.ReactNode }): JSX.Element
export function PageHeader(p: { title: string; subtitle?: string; actions?: React.ReactNode; breadcrumb?: {label:string; href?:string}[] }): JSX.Element
export function ModeBadge(p: { mode: 'live' | 'demo' }): JSX.Element
```

`src/components/charts/`（全部 `'use client'`，基于 `echarts/core` 按需注册，容器自适应 `ResizeObserver`）
```ts
export function Chart(p: { option: EChartsOption; height?: number; className?: string; loading?: boolean }): JSX.Element
export function TrendChart(p: { data: { date: string; [k: string]: number | string }[]; series: { key: string; label: string; color?: string; area?: boolean; type?: 'line'|'bar' }[]; height?: number; valueSuffix?: string }): JSX.Element
export function StackedBarChart(p: { data: { date: string; [k: string]: number | string }[]; series: { key: string; label: string; color?: string }[]; height?: number }): JSX.Element
export function RankBarChart(p: { rows: { label: string; value: number; hint?: string }[]; height?: number; valueSuffix?: string; maxRows?: number }): JSX.Element
export function DonutChart(p: { rows: { label: string; value: number; color?: string }[]; height?: number; centerLabel?: string; centerValue?: string }): JSX.Element
export function Sparkline(p: { values: number[]; height?: number; color?: string }): JSX.Element
export function WeekdayBarChart(p: { rows: { label: string; value: number }[]; height?: number }): JSX.Element
```

`src/lib/format.ts`
```ts
export function num(v: number | null | undefined): string             // 1234 -> '1,234'
export function compact(v: number | null | undefined): string         // 12345 -> '1.2万'
export function pct(v: number | null | undefined, digits?: number): string   // 0.1234 -> '12.3%'
export function deltaPct(cur: number, prev: number): number | null    // 1.0 表示 +100%；prev=0 -> null
export function shortDate(d: string | null | undefined): string        // '2026-03-02' -> '3/2'
export function relTime(iso: string | null | undefined): string        // '3 分钟前'
export function cn(...parts: (string | false | null | undefined)[]): string
```

`src/lib/client-api.ts`
```ts
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T>
export const api = {
  health(): Promise<HealthPayload>;
  repos(): Promise<{ repos: RepoSummary[] }>;
  addRepo(fullName: string): Promise<{ repo: RepoSummary; mode: DataMode }>;
  toggleRepo(id: number, enabled: boolean): Promise<{ repo: RepoSummary }>;
  deleteRepo(id: number): Promise<{ ok: true }>;
  sync(fullName?: string): Promise<{ runs: SyncRunRow[]; mode: DataMode }>;
  syncRuns(limit?: number): Promise<{ runs: SyncRunRow[]; mode: DataMode }>;
  metrics(fullName: string, days?: number): Promise<{ data: RepoMetrics }>;
  aggregate(days?: number, repos?: string[]): Promise<{ data: AggregateMetrics }>;
};
```

## 9. 派生指标口径（WP3 `analytics.ts` 唯一实现，其他人禁止重算）

- `cloneRate = clones / max(1, views)`（`views = 0` 时取 0）
- `avgCommitsPerDay = totalCommits / days`
- `closeRate = issuesClosed / max(1, issuesOpened)`
- `mergeRate = prMerged / max(1, prOpened + prMerged)`  <-- 统一为：`prMerged / max(1, prOpened + prMerged)`
- `staleOpenIssues`：由 `openIssues` 与近 `days` 天 `issuesClosed` 推算 = `max(0, openIssues - issuesClosed)`（无更细数据时的口径，契约固定）
- `starDelta = 区间末 stars - 区间初 stars`（无历史快照时取 0）
- `releaseCadenceDays`：按 `publishedAt` 倒序相邻间隔的中位数，样本 < 2 → `null`
- `busiestWeekday`：`activity.commits` 按周几聚合求和最大的中文星期，无数据 → `null`
- `healthScore`：
  ```
  traffic = min(100, 100 * Math.log1p(views) / Math.log1p(5000))
  activity = min(100, 100 * avgCommitsPerDay / 3)
  responsiveness = round(mergeRate * 60 + max(0, 1 - min(1, avgCloseHours / 336)) * 40)
  community = community?.healthPercentage ?? 50
  healthScore = round(0.30*traffic + 0.30*activity + 0.20*responsiveness + 0.20*community)
  ```
  其中 `avgCloseHours` 无法获得时按 168 处理。聚合页 `overall.healthScore` 为各仓库 `healthScore` 的按 `views` 加权平均（全部 views 为 0 时取算术平均）。

## 10. 洞察规则（WP3 `insights.ts`，中文输出，最多 6 条，按 level 排序 critical>warn>info>good）

必须实现以下规则，阈值可微调但语义不得改变：
1. 流量环比变化：`|deltaPct(totals.views, previousTotals.views)| >= 0.3` → good/critical
2. 克隆异常：`cloneRate > 0.25` → warn「克隆比例偏高，可能存在自动化同步或镜像」
3. 来源集中：top referrer 占比 `> 0.6` → info
4. 提交活跃度下滑：`deltaPct(totalCommits, 上期totalCommits) <= -0.4` → warn
5. Issues 积压：`closeRate < 0.5 && openIssues > 5` → warn
6. 社区健康：`healthPercentage < 100` → info，列出缺失项
7. Stars 增长：`starDelta > 0` → good
8. 最近 `days` 天零流量 → warn「近 N 天无访问记录（可能未公开）」

## 11. Next.js 16 硬性注意

- `app/**/page.tsx` 的 `params` 与 `searchParams` 都是 **Promise**，必须 `const { owner, repo } = await params`。
- Route handler 动态段同理：`{ params }: { params: Promise<{ owner: string; repo: string }> }`。
- 使用 `useSearchParams` 的客户端组件必须包在 `<Suspense>` 内或是叶子组件。
- 页面默认 Server Component。需要交互的组件文件首行写 `'use client'`。
- `next.config.ts` 需 `serverExternalPackages: []` 保持默认；不要在客户端引入 `node:sqlite`。
- 服务端读取跑库的文件（`db.ts` 等）不得被客户端组件导入。
- 图片：优先 `<img>` + `referrerPolicy`，避免 `next/image` 远程域名配置（头像来自 avatars.githubusercontent.com）。

## 12. 命令

```
pnpm install
pnpm db:migrate            # tsx scripts/db-migrate.ts  ← 建库建表
pnpm dev                   # next dev（默认 3000）
pnpm build                 # next build（必须零 TS 报错）
pnpm lint                  # next lint 或 tsc --noEmit
pnpm sync                  # tsx scripts/sync-cli.ts  （WP7）
pnpm smoke                 # tsx scripts/smoke.ts    （WP7）
```

`package.json` scripts 由 WP1 一次性写全（含上述全部），后续 WP 不得改动 scripts 名称。

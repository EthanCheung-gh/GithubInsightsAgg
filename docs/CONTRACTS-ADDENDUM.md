# 契约增补 v1.1（优先级高于 CONTRACTS.md 中的冲突描述）

## A1. 演示数据的归属：由数据管道负责写入真实表

**决策**：演示模式不是"读取时替换数据"，而是**同步阶段把合成数据写进同一批表**。
因此 `metrics-store.ts` / `analytics.ts` / 所有页面**无需区分模式**，只按普通表读取；`mode` 仅用于响应标记与 UI 提示。

新增归属（覆盖 CONTRACTS.md §3）：

| 文件 | 归属 |
| --- | --- |
| `src/lib/demo.ts` | **WP2** |
| `src/lib/bootstrap.ts` | **WP2** |

WP3 不创建 demo.ts；WP3 的 API handler 在入口调用一次 `ensureBootstrapped()`。

## A2. `src/lib/bootstrap.ts`

```ts
import type { DataMode } from './types';
/**
 * 幂等自举。规则：
 * - 已有仓库（repos 表非空）→ 什么也不做，返回 { seeded: false, mode }
 * - 无仓库 且 mode === 'demo' → 创建 3 个演示仓库并写入完整合成数据，返回 { seeded: true, mode: 'demo' }
 * - 无仓库 且 mode === 'live'  → 不自动加仓库（由用户添加），返回 { seeded: false, mode: 'live' }
 */
export function ensureBootstrapped(): { seeded: boolean; mode: DataMode };
```

调用点：WP3 的四个读接口 handler 开头、WP5/WP6 的 Server Component 页面开头。
禁止放在 `getDb()` 或模块顶层（避免副作用不可控）。

## A3. `src/lib/demo.ts`

```ts
import type { RepoSummary } from './types';

export const DEMO_REPOS: { owner: string; name: string; description: string; language: string; topics: string[] }[];
// 固定 3 个：demo/aurora-ui (TypeScript)、demo/nebula-api (Go)、demo/quanta-cli (Rust)

/** 依据仓库全名派生确定性伪随机种子，同一仓库每次生成的序列完全一致 */
export function demoBasics(fullName: string): {
  description: string; htmlUrl: string; defaultBranch: string; language: string;
  topics: string[]; stars: number; forks: number; watchers: number; openIssues: number;
  pushedAt: string; isPrivate: boolean; isArchived: boolean;
};

/** 把该仓库的全部合成数据写入 DB（覆盖式 upsert），返回写入行数 */
export function seedDemoRepoData(repo: RepoSummary, days: number): number;
```

要求：
- 确定性：用 `mulberry32(hash32(fullName))` 之类的自实现 PRNG，**不得使用 `Math.random()`**。
- 形态要像真实数据：工作日提交多、周末低；views 有缓慢上升趋势 + 噪声；referrers 含 github.com / Google / 直接访问；paths 含 `/`、`/issues`、`/pulls`、`/blob/...`；contributors 5~12 人；releases 3~8 个。
- 必须覆盖全部表：`repo_stat_snapshots` `traffic_daily` `traffic_referrers` `traffic_paths` `contributors` `commit_days` `participation_weeks` `issue_pr_daily` `releases` `repo_languages` `community_profiles`。
- 三个演示仓库的规模要**有区分度**（一个大流量高活跃、一个中等、一个冷清），这样排行榜/对比页才有意义。

## A4. `HealthPayload.tokenSource` 语义

`'env' | 'none'` 保持不变，但语义是"是否成功解析到 Token"：
- `process.env.GITHUB_TOKEN` / `GH_TOKEN` 有值 → `'env'`
- 否则 `gh auth token` 成功 → `'env'`（并在 `tokenSourceDetail` 里注明 `'gh-cli'`）
- 都失败 → `'none'`

为此 `HealthPayload` 增加一个可选字段（不得删除已有字段）：
```ts
tokenSourceDetail?: 'env' | 'gh-cli' | 'none';
```

## A5. GitHub 采集口径补充

- `repos.open_issues`：优先用 GraphQL `repository.issues(states: OPEN){ totalCount }`（**不含 PR**）；GraphQL 失败才回退 REST `open_issues_count`（含 PR，会有偏差）。
- `repos.watchers`：用 GraphQL `repository.watchers{ totalCount }`；不可用则 0。**不要**用 REST `watchers_count`（等于 stars）。
- `commit_days`：来自 `GET /stats/commit_activity`，返回 52 个 `{ week, days[7], total }`，按 `week + i 天` 展开为逐日。
- `participation_weeks.commits`：`GET /stats/participation` 的 `all` 数组（52 个，最后一个是本周）。`week_start` 用对应的周一日期键。
- `participation_weeks.additions/deletions`：来自 `GET /stats/code_frequency` 的 `[weekTs, additions, deletions]`，按周对齐；`deletions` 是负数，**入库前取绝对值**。
- `issue_pr_daily`：一次 GraphQL 拉最近 100 条 issues（createdAt/closedAt）与最近 100 条 PR（createdAt/closedAt/mergedAt），本地按日聚合。
  - `prOpened` 按 createdAt 计日；`prMerged` 按 mergedAt 计日；`prClosed` 只统计 `closedAt != null && mergedAt == null`。
  - `issuesOpened` 按 createdAt；`issuesClosed` 按 closedAt。
- `GET /stats/*` 系列在 GitHub 侧未命中缓存时会返回 **202 + 空 body**，必须视为"计算中"，退避重试（建议 3 次，间隔 1s/2s/4s）；仍 202 则该 collector 标记为 skipped，不影响其他 collector。
- 单个 collector 失败不得中断整个同步：记录到 `sync_runs.status = 'partial'` 并在 `error` 里拼接失败项。

## A6. 新增依赖白名单

允许使用 Node 内置模块（`node:child_process` 用于 `gh auth token`、`node:crypto`、`node:fs`、`node:path`）。
仍然**不允许**新增第三方依赖。

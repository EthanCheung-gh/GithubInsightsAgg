# GithubInsightsAgg 实施计划 (v1)

## 1. 项目定位

把 GitHub 仓库 Insights 页面分散的指标（Traffic / Commits / Contributors / Issues / Community）统一采集落库，提供**跨仓库聚合**、**趋势对比**与**规则化洞察**的分析平台。

与 GitHub 原生 Insights 的差异：

| 能力 | GitHub 原生 | 本项目 |
| --- | --- | --- |
| Traffic 历史 | 仅 14 天 | 每日落库，可长期留存与任意区间对比 |
| 跨仓库视图 | 无 | 聚合 KPI、排行榜、横向对比 |
| 历史留存 | 过期即失 | SQLite 本地持久化 |
| 洞察结论 | 只有裸图表 | 规则引擎输出中文结论与异常提示 |
| 健康度评分 | 无 | 0–100 复合评分，可排序 |

## 2. 技术决策（含理由）

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 应用形态 | Next.js 16 单体（App Router） | 前端 + API + 采集调度一个进程，Server Component 直连数据库，无跨服务鉴权与 CORS |
| 持久化 | Node 内置 `node:sqlite` | 零原生编译、零 ORM 版本漂移（Prisma 当前 latest 为 8.0.0-rc，风险高）；已验证 Node 26 可用 |
| 图表 | ECharts 6 + 自建薄封装 | 6 个通用组件覆盖全部图形，按需注册减小体积；避免图表库 peer 依赖冲突 |
| 数据源 | GitHub REST v3 + GraphQL v4 | Traffic 必须用带 push 权限的 REST；Issues/PR 用 GraphQL 一次拉 100 条本地聚合，节省配额 |
| 样式 | Tailwind CSS 4 + CSS 变量令牌 | 令牌集中在 `globals.css`，多页面并行开发不会样式冲突 |
| 无 Token 行为 | 确定性演示数据 | 保证任何环境下 UI/API 都可运行与验证 |

## 3. 数据采集矩阵

| Insights 模块 | GitHub 接口 | 落库表 | 配额 |
| --- | --- | --- | --- |
| 仓库基础信息 | `GET /repos/{o}/{r}` | `repos` | 1 |
| Stars/Forks 趋势 | 同上（每日快照） | `repo_stat_snapshots` | 0（本地快照） |
| 访问量 / 克隆 | `GET /repos/{o}/{r}/traffic/views` + `/clones` | `traffic_daily` | 2 |
| 来源排行 | `GET .../traffic/popular/referrers` | `traffic_referrers` | 1 |
| 热门页面 | `GET .../traffic/popular/paths` | `traffic_paths` | 1 |
| 提交频率 | `GET .../stats/commit_activity` | `commit_days` | 1 |
| 周参与度（增删行） | `GET .../stats/participation` + `/stats/code_frequency` | `participation_weeks` | 2 |
| 贡献者 | `GET .../contributors?per_page=100` | `contributors` | 1 |
| Issues / PR 健康度 | GraphQL 最近 100 条 issues/PR | `issue_pr_daily` | 1 |
| 语言构成 | `GET .../languages` | `repo_languages` | 1 |
| Release 节奏 | `GET .../releases?per_page=30` | `releases` | 1 |
| 社区健康档案 | `GET .../community/profile` | `community_profiles` | 1 |

单仓约 13 次请求；5000/h 配额可覆盖约 380 次全量同步，足够。

## 4. 页面结构

```
/                        总览：聚合 KPI、流量与提交趋势、仓库排行榜、跨仓洞察
/repos                   仓库管理：列表、添加、启停、单仓同步、删除
/repos/[owner]/[repo]    仓库详情（Tab）：概览 / 流量 / 活跃度 / Issues & PR
/compare                 多仓对比：指标矩阵、评分对比、流量对齐曲线
/settings                配置诊断：Token 状态、模式、同步记录、数据库路径
```

## 5. 分期与工作包

**Wave 1（阻塞）**
- WP1 地基：工程脚手架、`db/schema.sql`、`db.ts`、`types.ts`、`repo-store.ts`、`date.ts`、`config.ts`
  验收：`pnpm install && pnpm db:migrate` 成功，`tsc --noEmit` 通过。

**Wave 2（并行 3 路，互不重叠写域）**
- WP2 采集管道：GitHub 客户端（重试 / 限流 / 节流 / ETag 缓存）+ 4 组 collector + `sync.ts` 编排 + `/api/health`、`/api/sync`
- WP3 分析层：`metrics-store.ts`（读库聚合）、`analytics.ts`（派生指标与评分）、`insights.ts`（规则引擎）、`demo.ts`（确定性演示数据）、`/api/repos`、`/api/metrics`、`/api/aggregate`
- WP4 设计系统：`globals.css` 令牌、`AppShell/Sidebar/TopBar`、12 个 UI 组件、7 个图表组件、`format.ts`、`client-api.ts`

**Wave 3（并行 2 路）**
- WP5 总览与仓库管理/设置页（Server Component 直读库 + 客户端交互组件）
- WP6 仓库详情四 Tab + 多仓对比页

**Wave 4**
- WP7 文档、CLI 同步脚本、端到端 smoke 校验（建库 → 采集 → 各 API 200 → `build` 通过）

**每个 Wave 结束做一次 Reviewer 校验**；关键点：WP1 契约一致性、WP2 数据写入正确性、WP3 指标口径、Wave 3 后整体集成。

## 6. 验收标准

功能
1. `pnpm db:migrate && pnpm dev` 后首页在两种模式下都能出图（live 有 Token 走真实数据，无 Token 走演示数据并显式标注）。
2. 添加仓库 → 同步 → 详情页四个 Tab 全部有数据；重复添加返回 409；删除后级联清空。
3. `/compare` 至少两仓时给出排行榜与评分；单仓时给出友好空态。
4. `/settings` 正确显示 Token 来源、模式、最近同步记录。

工程质量
5. `pnpm build` 零 TS 错误、零 lint error。
6. 所有 API 有参数校验与错误码，不出现未捕获异常导致 500 崩溃。
7. 无 `any` 泛滥，无 `@ts-ignore`。
8. 无 Token 泄露到前端 bundle（`grep` 校验）。

## 7. 已知边界（v1 不做）

- 不做账号体系与多用户隔离（单用户自建）。
- 不做 GitHub App 安装流与 OAuth 登录。
- 不做定时任务守护（提供 `pnpm sync` 供 cron 调用）。
- 不做 AI 摘要（二期，接口位置已在 `insights.ts` 预留）。
- Traffic 只能采集有 push 权限的仓库，这是 GitHub 平台限制，UI 需说明。

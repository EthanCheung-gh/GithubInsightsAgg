# GithubInsightsAgg

**English** | [简体中文](README.zh-CN.md)

![license](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen)
![next](https://img.shields.io/badge/Next.js-16.4.6-black)
![react](https://img.shields.io/badge/React-19.3.1-61dafb)
![echarts](https://img.shields.io/badge/ECharts-6.1.0-aa344d)
![tailwind](https://img.shields.io/badge/Tailwind%20CSS-4.3.5-38bdf8)

Collect the metrics scattered across GitHub's per-repository Insights pages (traffic, commit activity, contributors, issues, community) into one local store, and analyse them with **cross-repo aggregation**, **trend comparison** and **rule-based insights**.

## Contents

1. [Overview](#1-overview)
2. [Features](#2-features)
3. [Quick start](#3-quick-start)
4. [GitHub token configuration](#4-github-token-configuration)
5. [Scripts](#5-scripts)
6. [Pages](#6-pages)
7. [HTTP API](#7-http-api)
8. [Data collection matrix](#8-data-collection-matrix)
9. [Metric definitions](#9-metric-definitions)
10. [Architecture](#10-architecture)
11. [Scheduled collection](#11-scheduled-collection)
12. [Known limitations](#12-known-limitations)
13. [Tech stack](#13-tech-stack)
14. [License](#license)

## 1. Overview

GithubInsightsAgg is a **self-hosted, single-process, single-user** GitHub analytics platform. It closes four gaps in GitHub's native Insights:

- **Traffic only lasts 14 days**: GitHub keeps only the last 14 days of views / clones detail, which is lost for good if you do not capture it. This project syncs daily and keeps every window in a local SQLite database, so history gets more complete the longer it runs.
- **No cross-repo view**: native Insights only shows one repository at a time, so there is no way to compare "which repository is worth further investment". This project provides aggregate KPIs, a leaderboard, health scores and a side-by-side comparison page.
- **No historical retention**: Stars / Forks / Open Issues are only available as current values. This project writes a daily snapshot, so range deltas can be computed.
- **Charts without conclusions**: a built-in rule engine emits insights and warnings (for example "clone ratio is high, likely automation or a mirror" or "no traffic in the last 30 days").

Data lives in a local SQLite file (`node:sqlite`, no ORM). Pages and API are served by the same Next.js process, so no extra service is required.

**Language note**: the dashboard copy and the generated insights are Simplified Chinese (`src/lib/insights.ts` emits Chinese titles and details). The data model, metric names and JSON API stay language-neutral, so the API is usable from any tooling. The Chinese edition of this document is [`README.zh-CN.md`](README.zh-CN.md).

## 2. Features

### Traffic (views and clones)

- Per-day `views` / `uniqueVisitors` / `clones` / `uniqueCloners`, for 7 / 30 / 90-day windows.
- Referrer ranking and popular paths.
- Clone ratio `cloneRate`, to spot mirror sites, CI pulls and automation.

### Code activity

- Daily commit curve (from GitHub `stats/commit_activity`).
- Weekly participation: commits / additions / deletions per week (`stats/participation` + `stats/code_frequency`).
- Top contributors (the API returns up to 100; the UI lists the top 20) plus the total commit count.
- Busiest weekday (`busiestWeekday`) and average commits per day (`avgCommitsPerDay`).

### Issues / PR health

- Per-day opened / closed issues, and opened / merged / closed-without-merge pull requests.
- Close rate `closeRate`, merge rate `mergeRate`, suspected backlog `staleOpenIssues`.
- Answers "is demand piling up, or being worked down?".

### Repository overview and community health

- Stars / Forks / Watchers / Open Issues, plus the range delta `starDelta`.
- Daily snapshot trend for stars and friends.
- Language mix (share of bytes).
- Release cadence: the most recent releases plus the median gap between adjacent releases (`releaseCadenceDays`).
- Community profile: health percentage and a 7-item checklist (README / LICENSE / CONTRIBUTING / CODE_OF_CONDUCT / issue template / PR template / description).

### Multi-repo aggregation and comparison

- Overview page: aggregate KPIs, a daily aggregate trend, a repository leaderboard, language mix and cross-repo insights.
- Compare page: 2–4 repositories side by side — metric matrix, views / commits / health-score charts, traffic-aligned trend and comparison insights.

### Rule-based insights

- Every repository, and the aggregate view, gets at most 6 insights sorted by severity (critical > warn > info > good).
- Covers: traffic change vs the previous window, clone ratio too high, referrer concentration, falling commit activity, issue backlog, missing community files, star growth, zero traffic in the range.
- Text is generated in Simplified Chinese; the `level` and `metric` fields are stable, so clients can key off them instead of the prose.

### Health score

- A 0–100 composite of traffic, activity, responsiveness and community health, sortable and comparable.
- The aggregate view's `overall.healthScore` is the `views`-weighted mean of the per-repo scores.

## 3. Quick start

Requires Node.js >= 22.5 (for the built-in `node:sqlite`) and pnpm.

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm dev        # http://localhost:3000
```

Then open <http://localhost:3000>. On an empty database the first request bootstraps demo data.

**Without a token the app runs in demo mode**: three synthetic repositories (`demo/aurora-ui`, `demo/nebula-api`, `demo/quanta-cli`) are written at large / medium / cold scale, so the leaderboard, the compare page and the insights all have realistic shapes and the UI is fully usable. The mode badge in the header states whether you are in `demo` or `live` mode.

Demo data is generated deterministically (the same repository always yields the same output) and needs no network access.

Note: if you have already run `gh auth login` on this machine, the project picks up that token and runs in `live` mode. Demo repositories are **not** seeded in that case — add a repository on `/repos`, or run `pnpm sync --repo owner/name` to land one first.

## 4. GitHub token configuration

There are three ways to give the app a token. Pick one — the recommended order is top to bottom.

### 4.1 In-app one-click authorization (recommended)

Uses GitHub's OAuth **Device Flow**, so no token is ever copied around.

1. Register an OAuth App on GitHub: **Settings → Developer settings → OAuth Apps → New OAuth App** (any name / homepage; the callback URL is not used by the device flow).
2. On the app's detail page, tick **Enable Device Flow**.
3. Put its Client ID into `.env` and restart the service:

   ```bash
   GITHUB_OAUTH_CLIENT_ID="Iv1.xxxxxxxxxxxx"
   ```

   **Only the Client ID is needed — no Client Secret.**
4. Open `/settings`, click **一键连接 GitHub**, copy the code shown on the page into the GitHub page that opens, and approve. The token is validated, stored locally and used immediately — no restart.

If `GITHUB_OAUTH_CLIENT_ID` is empty the settings page hides the button and falls back to 4.2.

### 4.2 In-app manual paste

On `/settings` click **去 GitHub 创建 Token**: the link is prefilled with the `repo` and `read:org` scopes (do not narrow them — without `repo` the traffic endpoints are off limits). Paste the token into the password field and save; it is verified with `GET /user`, stored in the local database and picked up immediately.

Supported token types:

- **Fine-grained PAT**: select the repositories to collect; grant at least `Metadata: Read-only`, `Contents: Read-only`, `Issues: Read-only`, `Pull requests: Read-only`. Traffic additionally needs `Administration: Read-only` (the traffic endpoints require push access to that repository).
- **Classic PAT**: tick `repo` (includes private repositories) or `public_repo` (public repositories only).

### 4.3 Environment variable / gh CLI

The classic path, best suited to CI and containers — put it in `.env`:

```bash
GITHUB_TOKEN="ghp_xxx"
```

`GH_TOKEN` is equivalent. When neither is set, the project also tries the locally logged-in `gh` CLI (`gh auth token`).

The resolution order is fixed: `GITHUB_TOKEN` → `GH_TOKEN` → token saved in the app (`app_settings.github_token`) → `gh auth token` → demo mode. Environment variables win, so leave `GITHUB_TOKEN` empty if you want to manage the token from the settings page.

**Traffic platform limit**: GitHub only lets a token read views / clones / referrers / paths for repositories that token can push to. For someone else's repository with read-only access, traffic collection fails while every other metric (commits, contributors, issues/PRs, languages, releases, community profile) is collected normally, and the sync run is marked "partial". This is a GitHub API limitation, not a defect of this project.

**Token storage**: a token saved from the settings page is kept in **plaintext** in the local SQLite database (`app_settings`). Only the server process reads it and every HTTP response returns a masked value (`ghp_…ab12`), but do not copy or share the `data/` directory — use an environment variable instead on a shared machine.

Collection throttling is configurable: `GITHUB_MIN_INTERVAL_MS` (default 80 ms).

## 5. Scripts

| Command | Purpose | Example |
| --- | --- | --- |
| `pnpm dev` | Local dev server (port 3000) | `pnpm dev` |
| `pnpm build` | Production build (includes the TypeScript check) | `pnpm build` |
| `pnpm start` | Start the production server (after `pnpm build`) | `pnpm start` |
| `pnpm lint` | Type check (`tsc --noEmit`) | `pnpm lint` |
| `pnpm typecheck` | Type check (same command as `pnpm lint`) | `pnpm typecheck` |
| `pnpm db:migrate` | Create the database and tables (idempotent) | `pnpm db:migrate` |
| `pnpm sync` | Command-line collection, for cron / CI | `pnpm sync --all --days 30`<br>`pnpm sync --repo owner/name`<br>`pnpm sync --repo owner/name --json` |
| `pnpm smoke` | End-to-end self-check (isolated database, CI friendly) | `pnpm smoke`<br>`pnpm smoke --url http://localhost:3000` |

### `pnpm sync` options

| Option | Description |
| --- | --- |
| `--repo <owner/name>` | Sync only that repository; a placeholder row is created first if it is not in the database (disabled repositories are synced too) |
| `--days <n>` | Collection window, 7–90, default 30 |
| `--all` | Sync all enabled repositories (the default behaviour); when combined with `--repo`, `--repo` wins and a warning is printed |
| `--json` | Machine-readable JSON output containing `scope / days / mode / dbPath / warnings / results / summary` |
| `-h`, `--help` | Print usage |

The default output is a human-readable table with `status / recordsWritten / durationMs / error` per row, followed by a summary (`success N / partial M / error K`), the `mode` and the database path.

Exit codes: `0` = everything succeeded or partially succeeded; `1` = at least one repository failed (handy for cron alerting); `2` = invalid arguments.

### `pnpm smoke` checks

`pnpm smoke` runs the whole chain against an **isolated database** first; it never touches your `data/insights.db`:

1. Schema: all 14 tables present.
2. Bootstrap: `ensureBootstrapped()` returns `{ seeded, mode }` and stays idempotent when called twice.
3. Repositories: the database contains at least one repository.
4. Metric computation: for a single repository over a 30-day window, `traffic.daily` / `activity.commits` / `issues.daily` / `overview.statsTrend` each have 30 points, `healthScore` is within 0–100, `insights` is an array, and a recursive scan finds no `NaN` / `Infinity`.
5. Aggregate: `overall.repos`, `trend.length` and `perRepo.length` match the repository count.
6. Empty-set edge case: `computeAggregate([], 30)` does not throw and yields `overall.repos === 0`.
7. HTTP (optional): with `--url`, `/api/health`, `/api/repos` and `/api/aggregate` must return 200 with the expected shape; without it the check reports `SKIP`.

Each check prints `PASS` / `FAIL` / `SKIP`, a failure does not abort the run, and the run ends with `smoke: N passed, M failed, K skipped`. Any FAIL makes the exit code 1.

## 6. Pages

| Path | Purpose |
| --- | --- |
| `/` | Overview: aggregate KPIs, views / clones trend, commit-activity trend, repository leaderboard, language mix, cross-repo insights; 7 / 30 / 90-day switch in the header |
| `/repos` | Repository management: list, add (`owner/name`), enable / disable, single-repo sync, delete (cascades to all related data), recent sync runs |
| `/repos/[owner]/[repo]` | Repository detail with 4 tabs: **Overview** (Stars/Forks trend, languages, release cadence, community checklist), **Traffic** (daily views and clones, referrer ranking, popular paths), **Activity** (daily commits, weekly additions/deletions, contributors, weekday distribution), **Issues & PR** (daily opened/closed/merged, close rate, merge rate, backlog); supports the day-range switch and re-syncing the repository |
| `/compare` | Multi-repo comparison: pick 2–4 repositories to get a metric matrix, views / commits / health-score comparison, traffic-aligned trend and comparison insights; shows an empty state when there are too few repositories |
| `/settings` | Configuration and diagnostics: GitHub token panel (one-click device-flow authorization, manual token paste, clear token), token source and current mode, database path, the last 20 sync runs, an explanation of collection scope, and "re-sync all" |

## 7. HTTP API

Convention: success is `200` with JSON (`POST /api/repos` returns `201` when it creates a repository); bad input is `400`; a missing resource is `404`; a conflict is `409`; a server error is `500` with a `{ error, detail? }` body.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health check and configuration diagnostics: `ok`, `version`, `mode`, token status and source, repository counts, last sync time, database path, rate-limit headroom |
| `GET` | `/api/repos` | Repository list (sorted by `stars` descending) |
| `POST` | `/api/repos` | Add a repository with `{ "fullName": "owner/name" }` (`{ owner, name }` is also accepted); an existing repository returns `409 { error: "repo_exists" }` |
| `PATCH` | `/api/repos/:id` | Enable / disable a repository with `{ enabled: boolean }` (a missing or non-boolean `enabled` returns `400 { error: "invalid_body" }`) |
| `DELETE` | `/api/repos/:id` | Delete a repository and cascade all related data |
| `POST` | `/api/sync` | Trigger collection with `{ fullName?, days? }` (`days` defaults to 30, allowed 7–90); omit `fullName` to sync every enabled repository |
| `GET` | `/api/sync` | Recent sync runs, with `?limit=` (default 20, max 100) |
| `GET` | `/api/metrics/:owner/:repo` | Full metrics for one repository, with `?days=30`; an unknown repository returns `404 { error: "repo_not_found" }`, and a repository that was never synced returns structure-complete zero metrics |
| `GET` | `/api/aggregate` | Aggregated metrics, with `?days=30&repos=owner/a,owner/b`; when `repos` is omitted all enabled repositories are used, and an empty result yields `overall.repos = 0` |
| `GET` | `/api/auth/token` | Current token state (never the plaintext): `configured`, `source` (`env` / `stored` / `gh-cli` / `none`), `maskedToken`, `canClear`, `deviceFlowAvailable` and the GitHub links |
| `POST` | `/api/auth/token` | Save a pasted token: validates it with `GET /user`, stores it locally, returns `{ ok, login, scopes, maskedToken }`; an invalid token returns `400 { error: "invalid_token" }` |
| `DELETE` | `/api/auth/token` | Clear the token saved in the app (`409 { error: "token_from_env" }` when it comes from the environment, `404 { error: "no_stored_token" }` when there is none) |
| `POST` | `/api/auth/device` | Start the OAuth Device Flow: `{ deviceCode, userCode, verificationUri, expiresIn, interval }`; `501 { error: "device_flow_unavailable" }` without `GITHUB_OAUTH_CLIENT_ID` |
| `GET` | `/api/auth/device` | Poll the device flow with `?deviceCode=`; always `200`, dispatch on `state`: `pending` / `slow_down` / `success` / `error` |

Those 14 "method + path" combinations map to 8 route files; field definitions are in section 6 of `docs/CONTRACTS.md`.

## 8. Data collection matrix

| Insights module | GitHub endpoint | Table | Requests |
| --- | --- | --- | --- |
| Repository basics | `GET /repos/{o}/{r}` + GraphQL counts (open issues / open PRs / watchers) | `repos` | 2 |
| Stars/Forks trend | same as above (daily snapshot) | `repo_stat_snapshots` | 0 (local snapshot) |
| Views / clones | `GET /repos/{o}/{r}/traffic/views` + `/clones` | `traffic_daily` | 2 |
| Referrer ranking | `GET .../traffic/popular/referrers` | `traffic_referrers` | 1 |
| Popular paths | `GET .../traffic/popular/paths` | `traffic_paths` | 1 |
| Commit frequency | `GET .../stats/commit_activity` | `commit_days` | 1 |
| Weekly participation (additions/deletions) | `GET .../stats/participation` + `/stats/code_frequency` | `participation_weeks` | 2 |
| Contributors | `GET .../contributors?per_page=100` | `contributors` | 1 |
| Issues / PR health | GraphQL, latest 100 issues and 100 PRs | `issue_pr_daily` | 1 |
| Languages | `GET .../languages` | `repo_languages` | 1 |
| Release cadence | `GET .../releases?per_page=30` | `releases` | 1 |
| Community profile | `GET .../community/profile` | `community_profiles` | 1 |

A full sync of one repository issues 14 requests (12 REST calls plus 2 GraphQL queries); the REST 5000/h quota therefore covers roughly 400 full syncs.

## 9. Metric definitions

Dates are always exposed as `YYYY-MM-DD` (UTC); every ratio is a `0–1` fraction and percentage formatting happens only in the UI.

- `cloneRate = clones / max(1, views)` (`0` when `views = 0`)
- `avgCommitsPerDay = totalCommits / days`
- `closeRate = issuesClosed / max(1, issuesOpened)`
- `mergeRate = prMerged / max(1, prOpened + prMerged)`
- `staleOpenIssues = max(0, openIssues - issuesClosed)`
- `starDelta = last stars in range - first stars in range` (`0` without history snapshots)
- `releaseCadenceDays`: median of adjacent gaps ordered by `publishedAt`; fewer than 2 samples → `null`
- `busiestWeekday`: `activity.commits` summed per weekday, the largest bucket; no data → `null`

`healthScore` (0–100):

```text
traffic        = min(100, 100 * log1p(views) / log1p(5000))
activity       = min(100, 100 * avgCommitsPerDay / 3)
responsiveness = round(mergeRate * 60 + max(0, 1 - min(1, avgCloseHours / 336)) * 40)
community      = community?.healthPercentage ?? 50

healthScore = round(0.30*traffic + 0.30*activity + 0.20*responsiveness + 0.20*community)
```

`avgCloseHours` is treated as 168 hours when it cannot be obtained, so the responsiveness term is an estimate. The aggregate view's `overall.healthScore` is the `views`-weighted mean of the per-repo scores (arithmetic mean when every `views` is 0).

## 10. Architecture

```text
GithubInsightsAgg/
├── src/
│   ├── app/          App Router: pages (overview / repos / detail / compare / settings) and REST API routes
│   ├── components/   UI primitives, chart wrappers, page sections (the only client-side entry points)
│   └── lib/          Server core: GitHub client and collectors, writers, read/aggregate layer, derived metrics, insight rules
├── db/               schema.sql (single source of truth for the 14 tables)
├── scripts/          Operational scripts: db:migrate / sync (cron collection) / smoke (end-to-end self-check)
├── docs/             Design and contract documents (PLAN, CONTRACTS, CONTRACTS-ADDENDUM)
├── data/             SQLite database files (default insights.db, gitignored)
└── root config       package.json, tsconfig.json, next.config.ts, postcss.config.mjs, .env.example
```

Data flow (strictly one direction; pages never compute metrics):

```text
GitHub REST v3 / GraphQL v4
        ↓  src/lib/github (client: retries / rate limiting / throttling; collectors: traffic / activity / issues / overview)
  src/lib/sync.ts (orchestration: one try/catch per section, a failing section → partial)
        ↓
  src/lib/sync-store.ts (parameterised SQL, upsert / replace semantics, writes run records)
        ↓
  SQLite (node:sqlite) · 14 tables
        ↓
  src/lib/metrics-store.ts (read-only, range queries)
        ↓
  src/lib/analytics.ts (derived metrics + healthScore) → src/lib/insights.ts (rule engine, Chinese text)
        ↓
  Server Component pages / REST API (/api/*)
```

Demo mode is not "substitute data at read time": the synthetic rows are written into the same tables during sync, so the read layer, the metrics and the pages all share one code path. `mode` only drives the response marker and the UI hint.

## 11. Scheduled collection

The project ships no scheduler; call `pnpm sync` from system cron:

```cron
# Every day at 03:00, collect the last 30-day window for all enabled repositories
0 3 * * * cd /srv/GithubInsightsAgg && /bin/bash -lc 'pnpm sync --all --days 30' >> /srv/GithubInsightsAgg/logs/sync.log 2>&1
```

Notes:

- cron's `PATH` is minimal; use `/bin/bash -lc '...'` (or an absolute pnpm path) so that nvm / corepack configuration is loaded.
- Create the `logs/` directory beforehand; the log is appended to.
- Exit codes work for alerting: `0` means everything succeeded or partially succeeded, `1` means at least one repository failed, `2` means invalid arguments. `MAILTO` makes cron mail you on a non-zero exit.
- For machine parsing use `pnpm sync --all --json`, which prints a single JSON object.
- Once a day is enough: the traffic window is only 14 days, so daily syncs never lose data while staying cheap on quota.

## 12. Known limitations

- **Traffic covers only 14 days**: GitHub exposes just the last 14 days, so history accumulates through daily syncs; the first run cannot show anything older.
- **Traffic needs push access**: a read-only token cannot collect views / clones for someone else's repository, and that run is marked "partial".
- **Contributors limited to the first 100**: `/contributors?per_page=100` fetches one page, so the contributor total of very large repositories is understated.
- **Issues / PRs limited to the latest 100 each**: GraphQL pulls the latest 100 issues and 100 PRs once, aggregated locally per day; older history never reaches `issue_pr_daily`.
- **`/stats/*` may answer "computing"**: when GitHub's cache is cold it returns 202 with an empty body; collection backs off and retries, and if it still fails that section is skipped and the run is partial.
- **`avgCloseHours` falls back to 168 hours**: the responsiveness term is therefore approximate.
- **A logged-in `gh` on the machine disables demo mode**: the token chain finds `gh auth token`, so an empty database is not seeded with demo repositories.
- **Single user, no authentication**: there are no accounts and no per-user isolation, so do not expose it to the public internet.
- **No built-in scheduler**: drive `pnpm sync` from cron or another external scheduler.
- **No GitHub App install flow**: tokens come from a PAT, the OAuth device flow (`GITHUB_OAUTH_CLIENT_ID`) or the `gh` CLI; there is no per-installation app token.
- **No AI summaries**: insights come entirely from the rule engine; model-generated summaries are future work (the extension point exists).
- **Open Issues definition**: the GraphQL `issues(states: OPEN){ totalCount }` count (excluding PRs) is preferred; when GraphQL is unavailable it falls back to REST's `open_issues_count`, which includes PRs and therefore reads high.

## 13. Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16.4.6 (App Router, Server Components query the database directly) |
| UI | React 19.3.1 + TypeScript 5.9 (`^5.9.0`) + Tailwind CSS 4.3.5 |
| Charts | ECharts 6.1.0 (on-demand registration plus thin local wrappers) |
| Storage | `node:sqlite` (Node's built-in `DatabaseSync`; no ORM, no native build, requires Node >= 22.5) |
| Data source | GitHub REST v3 (traffic / stats) + GraphQL v4 (issues / PRs / watcher counts) |
| Package manager | pnpm |

## License

MIT — see [LICENSE](LICENSE).

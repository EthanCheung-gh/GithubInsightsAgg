import { demoBasics, seedDemoRepoData } from './demo';
import { todayKey } from './date';
import {
  fetchActivity,
  fetchIssuesAndPrs,
  fetchOverview,
  fetchRepoBasics,
  fetchTraffic,
  githubErrorMessage,
  resolveToken,
  type RepoBasics,
} from './github';
import { getRepoById, listRepos, markSynced, updateRepoOverview } from './repo-store';
import {
  finishSyncRun,
  replaceContributors,
  replaceIssuePrDaily,
  replaceLanguages,
  replaceParticipationWeeks,
  replaceReleases,
  replaceTrafficPaths,
  replaceTrafficReferrers,
  startSyncRun,
  upsertCommitDays,
  upsertCommunityProfile,
  upsertStatSnapshot,
  upsertTrafficDaily,
} from './sync-store';
import type { DataMode, RepoSummary } from './types';

export interface SyncOptions {
  days?: number;
  trigger?: 'manual' | 'cli' | 'api';
}

export interface SyncRepoResult {
  repoId: number;
  fullName: string;
  status: 'success' | 'partial' | 'error';
  recordsWritten: number;
  error: string | null;
  runId: number;
}

const DEFAULT_DAYS = 30;
const MIN_DAYS = 7;
const MAX_DAYS = 90;

function normalizeDays(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_DAYS;
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.trunc(raw)));
}

/**
 * 当前数据模式：能解析到 Token（env 或 `gh auth token`）即 live，否则 demo。
 * API 层的响应标记也用它，保证「服务端能做什么」与「对外宣称什么」一致。
 */
export function effectiveMode(): DataMode {
  return resolveToken().token ? 'live' : 'demo';
}

/** `demo/xxx` 命名空间永远走合成数据（即便有 Token，也不会去 GitHub 拉一个不存在的仓库）。 */
function isDemoRepoNamespace(repo: RepoSummary): boolean {
  return repo.owner.trim().toLowerCase() === 'demo';
}

/**
 * 单仓同步。
 *
 * 编排（严格按任务书顺序）：
 * startSyncRun → （无 Token / demo 仓库）seedDemoRepoData
 *              → （live）4 组 collector，各自独立 try/catch
 * → 逐组写库并累计 recordsWritten → upsertStatSnapshot(today)
 * → markSynced → finishSyncRun（success / partial / error）。
 *
 * 最外层 try/catch 保证本函数**永不抛异常**：失败信息通过 SyncRepoResult 返回。
 */
export async function syncRepo(repo: RepoSummary, opts: SyncOptions = {}): Promise<SyncRepoResult> {
  const days = normalizeDays(opts.days);
  const trigger = opts.trigger ?? 'manual';
  const mode = effectiveMode();
  const startedAt = Date.now();

  let runId = 0;
  try {
    runId = startSyncRun({ repoId: repo.id, scope: 'repo', trigger, mode });
  } catch (error) {
    return {
      repoId: repo.id,
      fullName: repo.fullName,
      status: 'error',
      recordsWritten: 0,
      error: `sync_run_init_failed: ${githubErrorMessage(error)}`,
      runId: 0,
    };
  }

  const failures: string[] = [];
  let recordsWritten = 0;

  try {
    const useDemo = mode === 'demo' || isDemoRepoNamespace(repo);
    let stats: { stars: number; forks: number; watchers: number; openIssues: number } = {
      stars: repo.stars,
      forks: repo.forks,
      watchers: repo.watchers,
      openIssues: repo.openIssues,
    };

    if (useDemo) {
      // ---- 演示数据：直接写真实表（增补 A1） ----
      const basics = demoBasics(repo.fullName);
      updateRepoOverview(repo.id, {
        description: basics.description,
        htmlUrl: basics.htmlUrl,
        defaultBranch: basics.defaultBranch,
        language: basics.language,
        topics: basics.topics,
        isPrivate: basics.isPrivate,
        isArchived: basics.isArchived,
        stars: basics.stars,
        forks: basics.forks,
        watchers: basics.watchers,
        openIssues: basics.openIssues,
        pushedAt: basics.pushedAt,
      });
      const current = getRepoById(repo.id) ?? repo;
      recordsWritten += seedDemoRepoData(current, days);
      stats = {
        stars: basics.stars,
        forks: basics.forks,
        watchers: basics.watchers,
        openIssues: basics.openIssues,
      };
    } else {
      const capturedAt = todayKey();

      // ---- 仓库基础信息（前置：决定 description / 快照值） ----
      let basics: RepoBasics | null = null;
      let notFound = false;
      try {
        basics = await fetchRepoBasics(repo.owner, repo.name);
        if (!basics) notFound = true;
      } catch (error) {
        failures.push(`repo: ${githubErrorMessage(error)}`);
      }

      if (notFound) {
        const message = `repo_not_found: ${repo.fullName}`;
        markSynced(repo.id, { error: message });
        finishSyncRun(runId, {
          status: 'error',
          recordsWritten,
          error: message,
          durationMs: Date.now() - startedAt,
        });
        return {
          repoId: repo.id,
          fullName: repo.fullName,
          status: 'error',
          recordsWritten,
          error: message,
          runId,
        };
      }

      if (basics) {
        updateRepoOverview(repo.id, {
          description: basics.description,
          htmlUrl: basics.htmlUrl,
          defaultBranch: basics.defaultBranch,
          language: basics.language,
          topics: basics.topics,
          isPrivate: basics.isPrivate,
          isArchived: basics.isArchived,
          stars: basics.stars,
          forks: basics.forks,
          watchers: basics.watchers,
          openIssues: basics.openIssues,
          pushedAt: basics.pushedAt,
        });
        recordsWritten += 1;
        stats = {
          stars: basics.stars,
          forks: basics.forks,
          watchers: basics.watchers,
          openIssues: basics.openIssues,
        };
      }

      // ---- 1) traffic ----
      try {
        const traffic = await fetchTraffic(repo.owner, repo.name);
        if (!traffic) {
          // 仓库对该 Token 不可见（404）：不写库，也不清空已积累的 traffic 历史
          failures.push('traffic: 不可用(404，无 push 权限或仓库不可见)（已跳过写入）');
        } else {
          recordsWritten += upsertTrafficDaily(repo.id, traffic.daily);
          recordsWritten += replaceTrafficReferrers(repo.id, capturedAt, traffic.referrers);
          recordsWritten += replaceTrafficPaths(repo.id, capturedAt, traffic.paths);
        }
      } catch (error) {
        failures.push(`traffic: ${githubErrorMessage(error)}`);
      }

      // ---- 2) activity ----
      // 每段带 skipped 标记：只有确认拿到 2xx 才允许写库（replace* 是 DELETE+INSERT，
      // 用空数组覆盖会把已积累的历史数据静默清空）。
      try {
        const activity = await fetchActivity(repo.owner, repo.name);

        if (activity.commitDays.skipped) {
          failures.push(
            `活动度/commit_days: ${activity.commitDays.reason ?? '不可用'}（已跳过写入）`,
          );
        } else {
          recordsWritten += upsertCommitDays(repo.id, activity.commitDays.rows);
        }

        if (activity.weekly.skipped) {
          failures.push(
            `活动度/participation+code_frequency: ${activity.weekly.reason ?? '不可用'}（已跳过写入）`,
          );
        } else {
          recordsWritten += replaceParticipationWeeks(repo.id, activity.weekly.rows);
        }

        if (activity.contributors.skipped) {
          failures.push(
            `活动度/contributors: ${activity.contributors.reason ?? '不可用'}（已跳过写入）`,
          );
        } else {
          recordsWritten += replaceContributors(repo.id, capturedAt, activity.contributors.rows);
        }
      } catch (error) {
        failures.push(`activity: ${githubErrorMessage(error)}`);
      }

      // ---- 3) issues & pull requests ----
      try {
        const issues = await fetchIssuesAndPrs(repo.owner, repo.name, days);
        recordsWritten += replaceIssuePrDaily(repo.id, issues.daily);
        if (issues.openIssues !== null) {
          // 增补 A5：GraphQL 的开放 issue 数（不含 PR）优先，覆盖 repos.open_issues
          stats.openIssues = issues.openIssues;
          updateRepoOverview(repo.id, { openIssues: issues.openIssues });
        }
      } catch (error) {
        failures.push(`issues: ${githubErrorMessage(error)}`);
      }

      // ---- 4) overview（语言 / Release / 社区健康） ----
      try {
        const overview = await fetchOverview(
          repo.owner,
          repo.name,
          basics?.description ?? repo.description,
        );
        recordsWritten += replaceLanguages(repo.id, overview.languages);
        recordsWritten += replaceReleases(repo.id, overview.releases);
        if (overview.community) {
          recordsWritten += upsertCommunityProfile(repo.id, capturedAt, overview.community);
        }
      } catch (error) {
        failures.push(`overview: ${githubErrorMessage(error)}`);
      }
    }

    // ---- 当日快照（ON CONFLICT 覆盖当天，多次同步不叠加） ----
    try {
      recordsWritten += upsertStatSnapshot(repo.id, todayKey(), stats);
    } catch (error) {
      failures.push(`snapshot: ${githubErrorMessage(error)}`);
    }

    const status: SyncRepoResult['status'] = failures.length === 0 ? 'success' : 'partial';
    const error = failures.length > 0 ? failures.join('; ') : null;

    markSynced(repo.id, { error });
    finishSyncRun(runId, {
      status,
      recordsWritten,
      error,
      durationMs: Date.now() - startedAt,
    });

    return { repoId: repo.id, fullName: repo.fullName, status, recordsWritten, error, runId };
  } catch (error) {
    const message = githubErrorMessage(error);
    try {
      markSynced(repo.id, { error: message });
    } catch {
      // 状态回写失败不掩盖原始错误
    }
    try {
      finishSyncRun(runId, {
        status: 'error',
        recordsWritten,
        error: message,
        durationMs: Date.now() - startedAt,
      });
    } catch {
      // 同上
    }
    return {
      repoId: repo.id,
      fullName: repo.fullName,
      status: 'error',
      recordsWritten,
      error: message,
      runId,
    };
  }
}

/**
 * 全部 enabled 仓库串行同步。
 * 开头/结尾各写一条 `scope = 'all'` 的汇总 run（repo_id 为 null），
 * 单仓结果各自保留自己的 run，便于设置页展示。
 */
export async function syncAll(opts: SyncOptions = {}): Promise<SyncRepoResult[]> {
  const days = normalizeDays(opts.days);
  const trigger = opts.trigger ?? 'manual';
  const mode = effectiveMode();
  const startedAt = Date.now();

  let runId = 0;
  try {
    runId = startSyncRun({ repoId: null, scope: 'all', trigger, mode });
  } catch {
    runId = 0;
  }

  const results: SyncRepoResult[] = [];
  const failures: string[] = [];
  let recordsWritten = 0;

  try {
    for (const repo of listRepos({ enabledOnly: true, sort: 'name' })) {
      const result = await syncRepo(repo, { days, trigger });
      results.push(result);
      recordsWritten += result.recordsWritten;
      if (result.status !== 'success') {
        failures.push(`${result.fullName}: ${result.error ?? result.status}`);
      }
    }
  } catch (error) {
    failures.push(`sync_all: ${githubErrorMessage(error)}`);
  }

  let status: 'success' | 'partial' | 'error' = 'success';
  if (failures.length > 0) {
    status = results.some((result) => result.status === 'success') ? 'partial' : 'error';
  }

  if (runId > 0) {
    try {
      finishSyncRun(runId, {
        status,
        recordsWritten,
        error: failures.length > 0 ? failures.join('; ') : null,
        durationMs: Date.now() - startedAt,
      });
    } catch {
      // 汇总 run 落库失败不影响单仓结果
    }
  }

  return results;
}

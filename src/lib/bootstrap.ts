import { DEMO_REPOS, demoBasics, seedDemoRepoData } from './demo';
import { countRepos, getRepoByFullName, insertRepo, markSynced } from './repo-store';
import { effectiveMode } from './sync';
import { finishSyncRun, startSyncRun } from './sync-store';
import type { DataMode } from './types';

/**
 * 幂等自举（增补 A2）。
 *
 * - 已有仓库 → 什么也不做（`seeded: false`）
 * - 无仓库且 mode = demo → 建 3 个演示仓库并写入完整合成数据（`seeded: true`）
 * - 无仓库且 mode = live → 不自动加仓库，等用户添加（`seeded: false`）
 *
 * 调用点由 API handler / Server Component 负责；**不要**放进 `getDb()` 或模块顶层，
 * 否则会产生不可控的模块加载副作用。
 */
export function ensureBootstrapped(): { seeded: boolean; mode: DataMode } {
  const mode = effectiveMode();

  if (countRepos().total > 0) return { seeded: false, mode };
  if (mode !== 'demo') return { seeded: false, mode };

  let seeded = false;

  for (const item of DEMO_REPOS) {
    const fullName = `${item.owner}/${item.name}`;
    if (getRepoByFullName(fullName)) continue;

    const basics = demoBasics(fullName);
    const repo = insertRepo({
      owner: item.owner,
      name: item.name,
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
    seeded = true;

    // 演示仓库也留一条同步记录，设置页的「最近同步」才有内容可看。
    const startedAt = Date.now();
    let runId = 0;
    try {
      runId = startSyncRun({ repoId: repo.id, scope: 'repo', trigger: 'manual', mode: 'demo' });
      const written = seedDemoRepoData(repo, 30);
      markSynced(repo.id);
      finishSyncRun(runId, {
        status: 'success',
        recordsWritten: written,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        markSynced(repo.id, { error: message });
      } catch {
        // 状态回写失败不掩盖原始错误
      }
      if (runId > 0) {
        try {
          finishSyncRun(runId, {
            status: 'error',
            recordsWritten: 0,
            error: message,
            durationMs: Date.now() - startedAt,
          });
        } catch {
          // 同上
        }
      }
    }
  }

  return { seeded, mode };
}

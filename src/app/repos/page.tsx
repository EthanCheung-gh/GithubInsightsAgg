import type { Metadata } from 'next';

import { ModeBadge } from '@/components/layout/ModeBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { AddRepoForm } from '@/components/ui/AddRepoForm';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SyncButton } from '@/components/ui/SyncButton';
import { RepoTable } from '@/components/dashboard/RepoTable';
import { SyncRunTable } from '@/components/dashboard/SyncRunTable';
import { ensureBootstrapped } from '@/lib/bootstrap';
import { countRepos, listRepos } from '@/lib/repo-store';
import { listSyncRuns } from '@/lib/sync-store';
import { effectiveMode } from '@/lib/sync';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '仓库 · GithubInsightsAgg',
};

export default async function ReposPage() {
  ensureBootstrapped();

  const repos = listRepos({ sort: 'stars' });
  const counts = countRepos();
  const mode = effectiveMode();
  const runs = listSyncRuns(10);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="仓库"
        subtitle={`共 ${counts.total} 个，${counts.enabled} 个已启用`}
        actions={
          <>
            <ModeBadge mode={mode} />
            <SyncButton label="同步全部" />
          </>
        }
      />

      <Card title="添加仓库" subtitle="支持 owner/name 格式">
        <div className="flex flex-col gap-3">
          <AddRepoForm className="max-w-[420px]" />
          <p className="text-[12px] leading-relaxed text-muted">
            输入形如 <code className="tabular text-text">owner/name</code> 的仓库全名即可添加。
            Traffic（访问量 / 克隆量）数据受 GitHub 平台限制，需要该仓库的{' '}
            <span className="text-text">push 权限</span> 才能采集；其余指标在公开仓库上即可读取。
          </p>
        </div>
      </Card>

      <Card title="仓库列表" subtitle={repos.length > 0 ? `${repos.length} 个仓库` : undefined}>
        {repos.length === 0 ? (
          <EmptyState
            title="还没有仓库"
            description="在上方输入 owner/name 添加第一个仓库，添加时会立即同步一次数据。"
          />
        ) : (
          <RepoTable rows={repos} />
        )}
      </Card>

      <Card title="最近同步" subtitle="最近 10 次采集记录">
        <SyncRunTable runs={runs} />
      </Card>
    </div>
  );
}

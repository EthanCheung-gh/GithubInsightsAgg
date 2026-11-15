import { Suspense } from 'react';
import { notFound } from 'next/navigation';

import { computeRepoMetrics } from '@/lib/analytics';
import { ensureBootstrapped } from '@/lib/bootstrap';
import { getRepoByFullName, listRepos } from '@/lib/repo-store';
import { PageHeader } from '@/components/layout/PageHeader';
import { ModeBadge } from '@/components/layout/ModeBadge';
import { SyncButton } from '@/components/ui/SyncButton';
import { DetailTabs } from '@/components/metrics/DetailTabs';
import { RangeSwitch } from '@/components/metrics/RangeSwitch';
import { OverviewPanel } from '@/components/metrics/OverviewPanel';
import { TrafficPanel } from '@/components/metrics/TrafficPanel';
import { ActivityPanel } from '@/components/metrics/ActivityPanel';
import { IssuesPanel } from '@/components/metrics/IssuesPanel';

export const dynamic = 'force-dynamic';

const DAY_OPTIONS = [7, 30, 90];
const TAB_KEYS = ['overview', 'traffic', 'activity', 'issues'] as const;
type TabKey = (typeof TAB_KEYS)[number];

function parseDays(raw: string | undefined): number {
  const parsed = Number(raw);
  return DAY_OPTIONS.includes(parsed) ? parsed : 30;
}

function parseTab(raw: string | undefined): TabKey {
  return TAB_KEYS.includes(raw as TabKey) ? (raw as TabKey) : 'overview';
}

/** 仓库详情：服务端驱动 4 个页签，`?tab=` / `?days=` 刷新后保持。 */
export default async function RepoDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ days?: string; tab?: string }>;
}) {
  ensureBootstrapped();

  const { owner, repo: repoSlug } = await params;
  const sp = await searchParams;
  const days = parseDays(sp.days);
  const tab = parseTab(sp.tab);

  const requested = `${owner}/${repoSlug}`;
  let repo = getRepoByFullName(requested);
  if (!repo) {
    // URL 段大小写可能与库中不同：兜底做一次大小写不敏感匹配
    const target = requested.toLowerCase();
    repo = listRepos().find((item) => item.fullName.toLowerCase() === target) ?? null;
  }
  if (!repo) notFound();

  const metrics = computeRepoMetrics(repo, days);

  return (
    <div className="flex flex-col">
      <PageHeader
        title={repo.fullName}
        subtitle={repo.description ?? '无描述'}
        breadcrumb={[{ label: '仓库', href: '/repos' }, { label: repo.fullName }]}
        actions={
          <>
            <ModeBadge mode={metrics.mode} />
            <SyncButton fullName={repo.fullName} />
            <Suspense fallback={<div className="skeleton h-9 w-[228px] rounded-[8px]" />}>
              <RangeSwitch value={days} />
            </Suspense>
          </>
        }
      />

      <div className="mb-4">
        <Suspense fallback={<div className="h-9" />}>
          <DetailTabs value={tab} />
        </Suspense>
      </div>

      <div className="flex flex-col gap-4">
        {tab === 'overview' ? <OverviewPanel m={metrics} days={days} /> : null}
        {tab === 'traffic' ? <TrafficPanel m={metrics} /> : null}
        {tab === 'activity' ? <ActivityPanel m={metrics} days={days} /> : null}
        {tab === 'issues' ? <IssuesPanel m={metrics} /> : null}
      </div>
    </div>
  );
}

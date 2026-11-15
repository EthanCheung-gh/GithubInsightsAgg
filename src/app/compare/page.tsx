import { Suspense } from 'react';
import Link from 'next/link';

import { computeAggregate } from '@/lib/analytics';
import { ensureBootstrapped } from '@/lib/bootstrap';
import { listRepos } from '@/lib/repo-store';
import type { RepoSummary } from '@/lib/types';
import { compact, deltaPct, num } from '@/lib/format';
import { PageHeader } from '@/components/layout/PageHeader';
import { ModeBadge } from '@/components/layout/ModeBadge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { KpiCard } from '@/components/ui/KpiCard';
import { TrendChart } from '@/components/charts/TrendChart';
import { RankBarChart } from '@/components/charts/RankBarChart';
import { RangeSwitch } from '@/components/metrics/RangeSwitch';
import { RepoPicker } from '@/components/metrics/RepoPicker';
import { CompareMatrix } from '@/components/metrics/CompareMatrix';
import { InsightList } from '@/components/metrics/InsightList';
import { MAX_COMPARE_REPOS, healthTone, signedNum } from '@/components/metrics/helpers';

export const dynamic = 'force-dynamic';

const DAY_OPTIONS = [7, 30, 90];

function parseDays(raw: string | undefined): number {
  const parsed = Number(raw);
  return DAY_OPTIONS.includes(parsed) ? parsed : 30;
}

function parseRequestedRepos(raw: string | string[] | undefined): string[] {
  const joined = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
  return joined
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** 多仓对比：URL `?repos=a,b&days=30` 驱动，最多 4 个仓库。 */
export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; repos?: string | string[] }>;
}) {
  ensureBootstrapped();

  const sp = await searchParams;
  const days = parseDays(sp.days);
  const requested = parseRequestedRepos(sp.repos);

  const all = listRepos({ sort: 'stars' });
  const byName = new Map(all.map((repo) => [repo.fullName.toLowerCase(), repo]));

  const selected: RepoSummary[] = [];
  const seen = new Set<number>();
  for (const name of requested) {
    const hit = byName.get(name.toLowerCase());
    if (hit && !seen.has(hit.id)) {
      seen.add(hit.id);
      selected.push(hit);
    }
  }
  const hasUnknown = requested.length > selected.length;
  if (selected.length === 0) {
    selected.push(...all.slice(0, Math.min(2, all.length)));
  }
  const chosen = selected.slice(0, MAX_COMPARE_REPOS);

  const agg = computeAggregate(chosen, days);
  const selectedNames = chosen.map((repo) => repo.fullName);

  const header = (
    <PageHeader
      title="对比"
      subtitle="选择 2~4 个仓库横向对比"
      breadcrumb={[{ label: '对比' }]}
      actions={
        <>
          <ModeBadge mode={agg.mode} />
          <Suspense fallback={<div className="skeleton h-9 w-[228px] rounded-[8px]" />}>
            <RangeSwitch value={days} />
          </Suspense>
        </>
      }
    />
  );

  if (all.length === 0) {
    return (
      <div className="flex flex-col">
        {header}
        <Card>
          <EmptyState
            title="还没有仓库"
            description="先到仓库列表添加 owner/name，再回到这里做横向对比。"
            action={
              <Link href="/repos" className="btn btn--primary btn--sm">
                前往仓库列表
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  if (all.length === 1) {
    return (
      <div className="flex flex-col">
        {header}
        <Card>
          <EmptyState
            title="至少需要 2 个仓库才能对比"
            description={`当前只有 ${all[0].fullName}，再添加一个仓库即可开始横向对比。`}
            action={
              <Link href="/repos" className="btn btn--primary btn--sm">
                去添加仓库
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const rankViews = agg.perRepo.map((row) => ({
    label: row.fullName,
    value: row.views,
    hint: `克隆 ${compact(row.clones)} · 提交 ${compact(row.commits)}`,
  }));
  const rankCommits = agg.perRepo.map((row) => ({
    label: row.fullName,
    value: row.commits,
    hint: `日均 ${(row.commits / Math.max(1, days)).toFixed(2)} 次`,
  }));
  const rankHealth = agg.perRepo.map((row) => ({
    label: row.fullName,
    value: row.healthScore,
    hint: `访问 ${compact(row.views)} · 合并率 ${num(Math.round(row.mergeRate * 1000) / 10)}%`,
  }));

  return (
    <div className="flex flex-col">
      {header}

      <div className="flex flex-col gap-4">
        <Card title="选择仓库" subtitle={`已选 ${chosen.length} / 最多 ${MAX_COMPARE_REPOS} 个`}>
          <Suspense fallback={<div className="skeleton h-8 w-full rounded-[8px]" />}>
            <RepoPicker
              options={all.map((repo) => ({ fullName: repo.fullName, stars: repo.stars }))}
              selected={selectedNames}
            />
          </Suspense>
        </Card>

        {chosen.length === 1 ? (
          <div className="flex items-center gap-2 rounded-[8px] border border-warn bg-warn-soft px-3 py-2 text-[12px] text-warn">
            <span aria-hidden>ⓘ</span>
            <span>再选择 1 个仓库即可横向对比（当前仅 {selectedNames[0]}）。</span>
          </div>
        ) : null}

        {hasUnknown ? (
          <div className="flex items-center gap-2 rounded-[8px] border border-border bg-surface-2 px-3 py-2 text-[12px] text-muted">
            <span aria-hidden>ⓘ</span>
            <span>部分所选仓库不在本地库中，已忽略；请从上方列表重新勾选。</span>
          </div>
        ) : null}

        <Card title="指标矩阵" subtitle={`近 ${days} 天`}>
          <CompareMatrix rows={agg.perRepo} />
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="访问量对比">
            {rankViews.length === 0 ? (
              <EmptyState title="暂无访问量数据" />
            ) : (
              <RankBarChart rows={rankViews} valueSuffix=" 次" height={220} />
            )}
          </Card>
          <Card title="提交数对比">
            {rankCommits.length === 0 ? (
              <EmptyState title="暂无提交数据" />
            ) : (
              <RankBarChart rows={rankCommits} valueSuffix=" 次" height={220} />
            )}
          </Card>
          <Card title="健康度对比">
            {rankHealth.length === 0 ? (
              <EmptyState title="暂无健康度数据" />
            ) : (
              <RankBarChart rows={rankHealth} valueSuffix=" 分" height={220} />
            )}
          </Card>
        </div>

        <Card title="流量对齐趋势" subtitle={`近 ${days} 天 · 访问 / 克隆 / 提交`}>
          {agg.trend.length === 0 ? (
            <EmptyState title="暂无趋势数据" />
          ) : (
            <TrendChart
              data={agg.trend}
              series={[
                { key: 'views', label: '访问量', area: true },
                { key: 'clones', label: '克隆量', area: true },
                { key: 'commits', label: '提交数', type: 'bar' },
              ]}
              height={280}
            />
          )}
        </Card>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="覆盖仓库数" value={num(agg.overall.repos)} hint={`近 ${days} 天`} />
          <KpiCard
            label="总访问量"
            value={compact(agg.overall.views)}
            delta={deltaPct(agg.overall.views, agg.previous.views)}
            deltaLabel="vs 上期"
          />
          <KpiCard
            label="总克隆量"
            value={compact(agg.overall.clones)}
            delta={deltaPct(agg.overall.clones, agg.previous.clones)}
            deltaLabel="vs 上期"
          />
          <KpiCard
            label="总提交"
            value={compact(agg.overall.commits)}
            delta={deltaPct(agg.overall.commits, agg.previous.commits)}
            deltaLabel="vs 上期"
          />
          <KpiCard
            label="总 Stars"
            value={compact(agg.overall.stars)}
            delta={deltaPct(agg.overall.stars, agg.previous.stars)}
            deltaLabel={`近 ${days} 天`}
            hint={signedNum(agg.overall.starDelta)}
          />
          <KpiCard
            label="平均健康度"
            value={num(agg.overall.healthScore)}
            hint="/ 100"
            tone={healthTone(agg.overall.healthScore)}
          />
        </div>

        <Card title="对比洞察">
          <InsightList
            insights={agg.insights}
            emptyTitle="暂无对比洞察"
            emptyDescription="数据量足够后会自动生成规则化洞察。"
          />
        </Card>
      </div>
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { Activity, Download, Eye, GitCommitHorizontal, Info, Star, Users } from 'lucide-react';

import { DonutChart } from '@/components/charts/DonutChart';
import { TrendChart } from '@/components/charts/TrendChart';
import { ModeBadge } from '@/components/layout/ModeBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { KpiCard } from '@/components/ui/KpiCard';
import { SyncButton } from '@/components/ui/SyncButton';
import { InsightList } from '@/components/dashboard/InsightList';
import { RangeSwitch } from '@/components/dashboard/RangeSwitch';
import { RepoRankTable } from '@/components/dashboard/RepoRankTable';
import { computeAggregate } from '@/lib/analytics';
import { ensureBootstrapped } from '@/lib/bootstrap';
import { compact, deltaPct, pct } from '@/lib/format';
import { countRepos, listRepos } from '@/lib/repo-store';
import { effectiveMode } from '@/lib/sync';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '总览 · GithubInsightsAgg',
};

/** 允许的区间：7 / 30 / 90，非法值回退 30。 */
const DEFAULT_DAYS = 30;
const ALLOWED_DAYS = [7, 30, 90];

function parseDays(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value.trim() === '') return DEFAULT_DAYS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || !ALLOWED_DAYS.includes(parsed)) return DEFAULT_DAYS;
  return parsed;
}

function healthTone(score: number): 'neutral' | 'good' | 'warn' | 'danger' {
  if (score >= 70) return 'good';
  if (score >= 45) return 'warn';
  return 'danger';
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const sp = await searchParams;
  const days = parseDays(sp.days);

  ensureBootstrapped();

  const repos = listRepos({ enabledOnly: true, sort: 'stars' });
  const counts = countRepos();
  const mode = effectiveMode();

  const header = (
    <PageHeader
      title="总览"
      subtitle={`最近 ${days} 天 · ${repos.length} 个仓库 · ${mode === 'demo' ? '演示数据' : '实时数据'}`}
      actions={
        <>
          <ModeBadge mode={mode} />
          <SyncButton label="同步全部" />
          <RangeSwitch days={days} />
        </>
      }
    />
  );

  // 空态：没有任何启用的仓库时只保留标题区与引导。
  if (repos.length === 0) {
    return (
      <div>
        {header}
        <div className="card">
          <EmptyState
            title="还没有仓库"
            description={
              counts.total > 0
                ? `已添加 ${counts.total} 个仓库，但它们都处于停用状态。到「仓库」页面启用后即可查看聚合数据。`
                : '添加一个 owner/name 仓库，或配置 GITHUB_TOKEN 环境变量后采集真实 GitHub Insights 数据。'
            }
            action={
              <Link href="/repos" className="btn btn--primary">
                前往仓库页面
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const agg = computeAggregate(repos, days);
  const { overall, previous } = agg;
  const topLanguage = agg.languageMix[0];

  return (
    <div className="flex flex-col gap-5">
      {header}

      {mode === 'demo' ? (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-muted">
          <Info size={14} aria-hidden className="mt-0.5 shrink-0 text-accent" />
          <p>
            当前为演示数据。设置{' '}
            <code className="tabular rounded-[4px] border border-border bg-surface px-1 py-0.5 text-[11px] text-text">
              GITHUB_TOKEN
            </code>{' '}
            环境变量后将采集真实 GitHub Insights。
          </p>
        </div>
      ) : null}

      {/* KPI 行 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="访问量"
          value={compact(overall.views)}
          delta={deltaPct(overall.views, previous.views)}
          deltaLabel="vs 上期"
          icon={<Eye size={15} />}
        />
        <KpiCard
          label="独立访客"
          value={compact(overall.uniqueVisitors)}
          hint={`${overall.repos} 个仓库合计`}
          icon={<Users size={15} />}
        />
        <KpiCard
          label="克隆量"
          value={compact(overall.clones)}
          delta={deltaPct(overall.clones, previous.clones)}
          deltaLabel="vs 上期"
          hint={`克隆率 ${pct(overall.cloneRate)}`}
          icon={<Download size={15} />}
        />
        <KpiCard
          label="提交数"
          value={compact(overall.commits)}
          delta={deltaPct(overall.commits, previous.commits)}
          deltaLabel="vs 上期"
          icon={<GitCommitHorizontal size={15} />}
        />
        <KpiCard
          label="Stars"
          value={compact(Math.abs(overall.starDelta))}
          hint={`区间增量 · 共 ${compact(overall.stars)}`}
          icon={<Star size={15} />}
          tone={overall.starDelta > 0 ? 'good' : 'neutral'}
        />
        <KpiCard
          label="综合健康度"
          value={compact(overall.healthScore)}
          hint="0–100 分"
          icon={<Activity size={15} />}
          tone={healthTone(overall.healthScore)}
        />
      </div>

      {/* 趋势区 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="访问量 / 克隆量" subtitle={`最近 ${days} 天按日聚合`}>
          <TrendChart
            data={agg.trend}
            height={260}
            series={[
              { key: 'views', label: '访问量', area: true },
              { key: 'clones', label: '克隆量', area: true },
            ]}
          />
        </Card>
        <Card title="提交活跃度" subtitle={`最近 ${days} 天按日聚合`}>
          <TrendChart
            data={agg.trend}
            height={260}
            series={[{ key: 'commits', label: '提交', type: 'bar' }]}
          />
        </Card>
      </div>

      {/* 仓库排行 */}
      <Card title="仓库排行" subtitle="按访问量降序">
        <RepoRankTable rows={agg.perRepo} />
      </Card>

      {/* 聚合信息 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="语言构成" subtitle={topLanguage ? `主力 ${topLanguage.language}` : '暂无语言数据'}>
          {topLanguage ? (
            <DonutChart
              height={240}
              rows={agg.languageMix.map((item) => ({ label: item.language, value: item.bytes }))}
              centerValue={topLanguage.language}
              centerLabel="主力语言"
            />
          ) : (
            <EmptyState title="暂无语言数据" description="同步仓库后会按代码字节数统计语言构成。" />
          )}
        </Card>
        <Card title="洞察" subtitle={`共 ${agg.insights.length} 条`}>
          <InsightList insights={agg.insights} />
        </Card>
      </div>
    </div>
  );
}

import { CircleDot, Eye, GitCommitHorizontal, GitFork, HeartPulse, Star } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { KpiCard } from '@/components/ui/KpiCard';
import { TrendChart } from '@/components/charts/TrendChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { compact, deltaPct, num, pct } from '@/lib/format';
import type { RepoMetrics } from '@/lib/types';
import { CommunityPanel } from './CommunityPanel';
import { InsightList } from './InsightList';
import { ReleaseTable } from './ReleaseTable';
import { healthTone, signedNum } from './helpers';

/** 仓库详情 · 概览页签（服务端组件）。 */
export function OverviewPanel({ m, days }: { m: RepoMetrics; days: number }) {
  const o = m.overview;
  const previousStars = o.stars - o.starDelta;
  const starGrowth = deltaPct(o.stars, previousStars);
  const topLanguage = o.languages[0] ?? null;
  const cadence = o.releaseCadenceDays;
  // TrendChart 的 data 需要索引签名：把接口对象摊平成普通记录
  const trendRows = o.statsTrend.map((point) => ({ ...point }));
  const hasStatsTrend = o.statsTrend.some((point) => point.stars > 0 || point.forks > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Stars"
          value={compact(o.stars)}
          delta={starGrowth}
          deltaLabel={`近 ${days} 天`}
          hint={signedNum(o.starDelta)}
          icon={<Star size={15} />}
          tone={o.starDelta > 0 ? 'good' : 'neutral'}
        />
        <KpiCard label="Forks" value={compact(o.forks)} icon={<GitFork size={15} />} />
        <KpiCard label="Watchers" value={compact(o.watchers)} icon={<Eye size={15} />} />
        <KpiCard
          label="未关闭 Issue"
          value={compact(o.openIssues)}
          hint={`积压 ${num(m.issues.staleOpenIssues)}`}
          icon={<CircleDot size={15} />}
          tone={o.openIssues > 20 ? 'warn' : 'neutral'}
        />
        <KpiCard
          label="健康度"
          value={num(m.healthScore)}
          hint="/ 100"
          icon={<HeartPulse size={15} />}
          tone={healthTone(m.healthScore)}
        />
        <KpiCard
          label="区间提交数"
          value={compact(m.activity.totalCommits)}
          hint={`日均 ${m.activity.avgCommitsPerDay.toFixed(2)}`}
          deltaLabel={`近 ${days} 天`}
          icon={<GitCommitHorizontal size={15} />}
        />
      </div>

      <Card title="Stars / Forks 趋势" subtitle={`近 ${days} 天快照`}>
        {!hasStatsTrend ? (
          <EmptyState title="暂无历史快照" description="同步该仓库后会记录每日 Stars / Forks 快照。" />
        ) : (
          <TrendChart
            data={trendRows}
            series={[
              { key: 'stars', label: 'Stars', area: true },
              { key: 'forks', label: 'Forks' },
            ]}
            height={240}
          />
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="语言构成" subtitle={topLanguage ? `首位 ${topLanguage.language} · ${pct(topLanguage.percent)}` : undefined}>
          {o.languages.length === 0 ? (
            <EmptyState title="未采集语言构成" description="同步该仓库后会拉取 Languages 数据。" />
          ) : (
            <DonutChart
              rows={o.languages.map((item) => ({ label: item.language, value: item.bytes }))}
              height={240}
              centerValue={topLanguage ? topLanguage.language : undefined}
              centerLabel={topLanguage ? pct(topLanguage.percent) : undefined}
            />
          )}
        </Card>
        <Card title="社区健康">
          <CommunityPanel community={o.community} />
        </Card>
      </div>

      <Card
        title="发布节奏"
        subtitle={o.releases.length > 0 ? `最近 ${o.releases.length} 个 Release` : undefined}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[11px] text-muted">平均发布间隔</span>
            <span className="tabular text-[16px] font-semibold leading-none text-text">
              {cadence === null ? '—' : `约 ${Math.round(cadence * 10) / 10} 天/次`}
            </span>
          </div>
          <ReleaseTable rows={o.releases} />
        </div>
      </Card>

      <Card title="洞察">
        <InsightList insights={m.insights} emptyTitle="暂无洞察" emptyDescription="数据量足够后会自动生成规则化洞察。" />
      </Card>
    </div>
  );
}

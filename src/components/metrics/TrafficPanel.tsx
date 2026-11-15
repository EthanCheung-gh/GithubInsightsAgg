import { Download, Eye, GitFork, Percent, TrendingUp, Users } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { KpiCard } from '@/components/ui/KpiCard';
import { TrendChart } from '@/components/charts/TrendChart';
import { RankBarChart } from '@/components/charts/RankBarChart';
import { compact, deltaPct, num, pct } from '@/lib/format';
import type { RepoMetrics } from '@/lib/types';

/** 仓库详情 · 流量页签（服务端组件）。 */
export function TrafficPanel({ m }: { m: RepoMetrics }) {
  const t = m.traffic;
  const viewDelta = deltaPct(t.totals.views, t.previousTotals.views);
  const cloneDelta = deltaPct(t.totals.clones, t.previousTotals.clones);

  const referrerRows = t.referrers.map((row) => ({
    label: row.referrer,
    value: row.count,
    hint: `${num(row.uniques)} 独立访客`,
  }));
  const pathRows = t.paths.map((row) => ({
    label: row.title || row.path,
    value: row.count,
    hint: `${row.path} · ${num(row.uniques)} 独立访客`,
  }));
  // TrendChart 的 data 需要索引签名：把接口对象摊平成普通记录
  const dailyRows = t.daily.map((point) => ({ ...point }));
  const hasViewData = t.totals.views > 0 || t.totals.uniqueVisitors > 0;
  const hasCloneData = t.totals.clones > 0 || t.totals.uniqueCloners > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="访问量"
          value={compact(t.totals.views)}
          delta={viewDelta}
          deltaLabel="vs 上期"
          icon={<Eye size={15} />}
        />
        <KpiCard
          label="独立访客"
          value={compact(t.totals.uniqueVisitors)}
          icon={<Users size={15} />}
        />
        <KpiCard
          label="克隆量"
          value={compact(t.totals.clones)}
          delta={cloneDelta}
          deltaLabel="vs 上期"
          icon={<Download size={15} />}
        />
        <KpiCard
          label="独立克隆者"
          value={compact(t.totals.uniqueCloners)}
          icon={<GitFork size={15} />}
        />
        <KpiCard
          label="克隆率"
          value={pct(t.cloneRate)}
          hint="克隆量 / 访问量"
          icon={<Percent size={15} />}
          tone={t.cloneRate > 0.25 ? 'warn' : 'neutral'}
        />
        <KpiCard
          label="访问量环比"
          value={viewDelta === null ? '—' : `${viewDelta >= 0 ? '+' : ''}${pct(viewDelta)}`}
          hint={`上期 ${compact(t.previousTotals.views)}`}
          icon={<TrendingUp size={15} />}
          tone={viewDelta === null ? 'neutral' : viewDelta >= 0 ? 'good' : 'danger'}
        />
      </div>

      <Card title="访问量 / 独立访客" subtitle="按日">
        {!hasViewData ? (
          <EmptyState title="暂无流量数据" description="同步该仓库后会写入最近 14 天的 Traffic 记录。" />
        ) : (
          <TrendChart
            data={dailyRows}
            series={[
              { key: 'views', label: '访问量', area: true },
              { key: 'uniqueVisitors', label: '独立访客' },
            ]}
            height={260}
          />
        )}
      </Card>

      <Card title="克隆量" subtitle="按日">
        {!hasCloneData ? (
          <EmptyState title="暂无克隆数据" description="同步该仓库后会写入最近 14 天的 Clone 记录。" />
        ) : (
          <TrendChart
            data={dailyRows}
            series={[
              { key: 'clones', label: '克隆量', area: true },
              { key: 'uniqueCloners', label: '独立克隆者' },
            ]}
            height={240}
          />
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="来源排行" subtitle={referrerRows.length > 0 ? `共 ${referrerRows.length} 个来源，按访问次数排序` : '暂无来源数据'}>
          {referrerRows.length === 0 ? (
            <EmptyState title="暂无来源数据" />
          ) : (
            <RankBarChart rows={referrerRows} valueSuffix=" 次" />
          )}
        </Card>
        <Card title="热门页面" subtitle={pathRows.length > 0 ? `共 ${pathRows.length} 个页面，按访问次数排序` : '暂无页面数据'}>
          {pathRows.length === 0 ? (
            <EmptyState title="暂无页面数据" />
          ) : (
            <RankBarChart rows={pathRows} valueSuffix=" 次" />
          )}
        </Card>
      </div>

      <p className="text-[11px] leading-relaxed text-subtle">
        GitHub 仅提供最近 14 天的 Traffic 数据；缺失日期已按 0 补齐。
      </p>
    </div>
  );
}

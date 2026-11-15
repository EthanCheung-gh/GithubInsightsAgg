import { CircleDot, CircleSlash, GitMerge, GitPullRequest, Percent, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { KpiCard } from '@/components/ui/KpiCard';
import { StackedBarChart } from '@/components/charts/StackedBarChart';
import { compact, num, pct } from '@/lib/format';
import type { RepoMetrics } from '@/lib/types';

/** 仓库详情 · Issues & PR 页签（服务端组件）。 */
export function IssuesPanel({ m }: { m: RepoMetrics }) {
  const i = m.issues;
  const totals = i.totals;
  const hasIssueData = totals.issuesOpened > 0 || totals.issuesClosed > 0;
  const hasPrData = totals.prOpened > 0 || totals.prMerged > 0 || totals.prClosed > 0;

  // StackedBarChart 的 data 需要索引签名：把接口对象摊平成普通记录
  const dailyRows = i.daily.map((point) => ({ ...point }));
  const statusRows: { label: string; value: string }[] = [
    { label: '未关闭 Issue', value: num(i.openIssues) },
    { label: '疑似积压（未关闭 − 区间已关闭）', value: num(i.staleOpenIssues) },
    { label: 'PR 合并率', value: pct(i.mergeRate) },
    { label: 'Issue 关闭率', value: pct(i.closeRate) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="新开 Issue" value={compact(totals.issuesOpened)} icon={<CircleDot size={15} />} />
        <KpiCard
          label="关闭 Issue"
          value={compact(totals.issuesClosed)}
          icon={<CircleSlash size={15} />}
        />
        <KpiCard label="新开 PR" value={compact(totals.prOpened)} icon={<GitPullRequest size={15} />} />
        <KpiCard label="合并 PR" value={compact(totals.prMerged)} icon={<GitMerge size={15} />} />
        <KpiCard
          label="合并率"
          value={pct(i.mergeRate)}
          hint="合并 / (新开 + 合并)"
          icon={<Percent size={15} />}
          tone={i.mergeRate >= 0.6 ? 'good' : i.mergeRate >= 0.3 ? 'warn' : 'danger'}
        />
        <KpiCard
          label="关闭率"
          value={pct(i.closeRate)}
          hint="关闭 / 新开"
          icon={<TrendingUp size={15} />}
          tone={i.closeRate >= 0.6 ? 'good' : i.closeRate >= 0.3 ? 'warn' : 'danger'}
        />
      </div>

      <Card title="Issue 开闭趋势" subtitle="按日">
        {!hasIssueData ? (
          <EmptyState title="暂无 Issue 数据" description="同步该仓库后会写入最近的 Issue 开闭记录。" />
        ) : (
          <StackedBarChart
            data={dailyRows}
            series={[
              { key: 'issuesOpened', label: '新开 Issue' },
              { key: 'issuesClosed', label: '关闭 Issue' },
            ]}
            height={240}
          />
        )}
      </Card>

      <Card title="PR 开闭趋势" subtitle="按日">
        {!hasPrData ? (
          <EmptyState title="暂无 PR 数据" description="同步该仓库后会写入最近的 PR 开闭记录。" />
        ) : (
          <StackedBarChart
            data={dailyRows}
            series={[
              { key: 'prOpened', label: '新开 PR' },
              { key: 'prMerged', label: '合并 PR' },
              { key: 'prClosed', label: '关闭未合并 PR' },
            ]}
            height={240}
          />
        )}
      </Card>

      <Card title="当前状态">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {statusRows.map((row) => (
            <div key={row.label} className="rounded-[8px] border border-border bg-surface-2 px-3 py-2">
              <dt className="text-[11px] leading-snug text-muted">{row.label}</dt>
              <dd className="tabular mt-1 text-[18px] font-semibold leading-none text-text">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <p className="text-[11px] leading-relaxed text-subtle">
        Issue/PR 数据基于 GitHub GraphQL 最近 100 条记录，长尾历史可能未覆盖。
      </p>
    </div>
  );
}

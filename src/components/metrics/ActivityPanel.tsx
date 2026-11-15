import { CalendarDays, GitCommitHorizontal, Users } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { KpiCard } from '@/components/ui/KpiCard';
import { TrendChart } from '@/components/charts/TrendChart';
import { WeekdayBarChart } from '@/components/charts/WeekdayBarChart';
import { StackedBarChart } from '@/components/charts/StackedBarChart';
import { compact, num } from '@/lib/format';
import type { RepoMetrics } from '@/lib/types';
import { ContributorTable } from './ContributorTable';
import { commitsByWeekday } from './helpers';

/** 仓库详情 · 活跃度页签（服务端组件）。 */
export function ActivityPanel({ m, days }: { m: RepoMetrics; days: number }) {
  const a = m.activity;
  const additions = a.weekly.reduce((acc, week) => acc + (Number.isFinite(week.additions) ? week.additions : 0), 0);
  const deletions = a.weekly.reduce((acc, week) => acc + (Number.isFinite(week.deletions) ? week.deletions : 0), 0);
  const weekdayRows = commitsByWeekday(a.commits);
  // StackedBarChart 要求 `date` 字段：把周起始日映射过去
  const weeklyRows = a.weekly.map((week) => ({
    date: week.weekStart,
    additions: week.additions,
    deletions: week.deletions,
  }));
  // TrendChart 的 data 需要索引签名：把接口对象摊平成普通记录
  const commitRows = a.commits.map((point) => ({ ...point }));
  const hasCommits = a.totalCommits > 0;
  const hasWeekly = a.weekly.some(
    (week) => week.commits > 0 || week.additions > 0 || week.deletions > 0,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="区间提交数"
          value={compact(a.totalCommits)}
          deltaLabel={`近 ${days} 天`}
          icon={<GitCommitHorizontal size={15} />}
        />
        <KpiCard
          label="日均提交"
          value={a.avgCommitsPerDay.toFixed(2)}
          hint="次/天"
          icon={<CalendarDays size={15} />}
        />
        <KpiCard label="最活跃星期" value={a.busiestWeekday ?? '—'} hint="按提交量聚合" />
        <KpiCard
          label="贡献者数"
          value={num(a.contributors.length)}
          hint="Top 20 展示"
          icon={<Users size={15} />}
        />
        <KpiCard
          label="新增 / 删除行"
          value={
            <span className="tabular text-[20px]">
              +{compact(additions)} / −{compact(deletions)}
            </span>
          }
          hint="按区间周参与度求和"
        />
      </div>

      <Card title="提交趋势" subtitle="按日">
        {!hasCommits ? (
          <EmptyState title="暂无提交数据" description="同步该仓库后会写入近 52 周的逐日提交。" />
        ) : (
          <TrendChart
            data={commitRows}
            series={[{ key: 'count', label: '提交数', area: true }]}
            height={240}
          />
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="星期分布" subtitle="周一 → 周日">
          {!hasCommits ? (
            <EmptyState title="暂无提交数据" />
          ) : (
            <WeekdayBarChart rows={weekdayRows} height={220} />
          )}
        </Card>
        <Card title="周参与度（增删行）" subtitle="按周">
          {!hasWeekly ? (
            <EmptyState title="暂无周参与度数据" />
          ) : (
            <StackedBarChart
              data={weeklyRows}
              series={[
                { key: 'additions', label: '新增行' },
                { key: 'deletions', label: '删除行' },
              ]}
              height={220}
            />
          )}
        </Card>
      </div>

      <Card title="贡献者" subtitle="按提交数降序 · Top 20">
        <ContributorTable rows={a.contributors} />
      </Card>
    </div>
  );
}

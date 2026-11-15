import { CalendarRange, FileCode2, Minus, Plus, TrendingUp } from 'lucide-react';

import { DonutChart } from '@/components/charts/DonutChart';
import { StackedBarChart } from '@/components/charts/StackedBarChart';
import { TrendChart } from '@/components/charts/TrendChart';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { KpiCard } from '@/components/ui/KpiCard';
import { cn, compact, num, shortDate } from '@/lib/format';
import type { RepoMetrics } from '@/lib/types';
import { CodeLanguageTable } from './CodeLanguageTable';
import { signedNum } from './helpers';

/**
 * 仓库详情 · 代码量页签（服务端组件）。
 *
 * 行数全部是估算值：GitHub 只提供每种语言的字节数，这里按语言平均行长换算，
 * 用于把握量级；增删行来自 `code_frequency`（近 52 周）。
 */
export function CodePanel({ m }: { m: RepoMetrics }) {
  const code = m.code;
  const days = m.range.days;
  const hasCode = !(code.estimatedLines === 0 && code.weekly.length === 0);

  if (!hasCode) {
    return (
      <div className="card">
        <EmptyState
          title="暂无代码量数据"
          description="同步该仓库后会采集语言字节数（Languages）与每周增删（code_frequency），再按语言平均行长换算成估算行数。"
        />
      </div>
    );
  }

  const net = code.last30d.net;
  const netClass = net > 0 ? 'text-success' : net < 0 ? 'text-danger' : 'text-muted';
  const peakWeek = code.peakWeek;
  const hasLanguages = code.byLanguage.length > 0;
  const hasWeekly = code.weekly.length > 0;
  // TrendChart / StackedBarChart 的 data 需要索引签名：把接口对象摊平成普通记录
  const trendRows = code.weekly.map((week) => ({
    date: week.weekStart,
    cumulative: week.cumulative,
    net: week.net,
  }));
  const weeklyRows = code.weekly.map((week) => ({
    date: week.weekStart,
    additions: week.additions,
    deletions: week.deletions,
  }));
  const donutRows = code.byLanguage.map((item) => ({ label: item.language, value: item.lines }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="估算代码行数"
          value={compact(code.estimatedLines)}
          hint={`按 ${code.bytesPerLine} 字节/行 估算`}
          icon={<FileCode2 size={15} />}
          tone="neutral"
        />
        <KpiCard
          label={`近 ${days} 天新增`}
          value={compact(code.last30d.additions)}
          hint="按周聚合"
          icon={<Plus size={15} />}
          tone="good"
        />
        <KpiCard
          label={`近 ${days} 天删除`}
          value={compact(code.last30d.deletions)}
          hint="按周聚合"
          icon={<Minus size={15} />}
          tone="danger"
        />
        <KpiCard
          label="净增行数"
          value={<span className={cn('tabular', netClass)}>{signedNum(net)}</span>}
          hint={`周均 ${num(code.avgWeeklyNet)}`}
          icon={<TrendingUp size={15} />}
          tone={net < 0 ? 'danger' : 'good'}
        />
        <KpiCard
          label="峰值周"
          value={peakWeek ? shortDate(peakWeek.weekStart) : '—'}
          hint={peakWeek ? `净增 ${signedNum(peakWeek.net)}` : '暂无周数据'}
          icon={<CalendarRange size={15} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="语言构成" subtitle="按估算行数">
          {!hasLanguages ? (
            <EmptyState title="暂无语言数据" description="同步该仓库后会拉取 Languages 字节数。" />
          ) : (
            <DonutChart
              rows={donutRows}
              height={240}
              centerValue={compact(code.estimatedLines)}
              centerLabel="估算行数"
            />
          )}
        </Card>
        <Card title="语言明细" subtitle={`${num(code.byLanguage.length)} 种语言 · 按估算行数降序`}>
          <CodeLanguageTable rows={code.byLanguage} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="累计净增（周）" subtitle="近 52 周 code_frequency 累计">
          {!hasWeekly ? (
            <EmptyState title="暂无周增删数据" description="同步该仓库后会写入每周 additions / deletions。" />
          ) : (
            <TrendChart
              data={trendRows}
              series={[{ key: 'cumulative', label: '累计净增行', area: true }]}
              height={240}
              valueSuffix=" 行"
            />
          )}
        </Card>
        <Card title="每周增删" subtitle="近 52 周 · 新增 / 删除行数">
          {!hasWeekly ? (
            <EmptyState title="暂无周增删数据" description="同步该仓库后会写入每周 additions / deletions。" />
          ) : (
            <StackedBarChart
              data={weeklyRows}
              series={[
                { key: 'additions', label: '新增' },
                { key: 'deletions', label: '删除' },
              ]}
              height={240}
            />
          )}
        </Card>
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        行数为估算：GitHub 仅提供每种语言的字节数，本页按语言平均行长换算（当前采用{' '}
        <span className="tabular text-text">{code.bytesPerLine}</span> 字节/行），用于把握量级而非精确计数。
        增删数据来自 code_frequency，只覆盖近 52 周。
      </p>
    </div>
  );
}

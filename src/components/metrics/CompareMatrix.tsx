'use client';

import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { compact, num, pct } from '@/lib/format';
import type { RepoRankRow } from '@/lib/types';
import { healthTone } from './helpers';

const COLUMNS: Column<RepoRankRow>[] = [
  {
    key: 'fullName',
    header: '仓库',
    width: '22%',
    sortValue: (row) => row.fullName,
    render: (row) => (
      <Link
        href={`/repos/${row.fullName}`}
        className="block max-w-[260px] truncate font-medium text-text hover:text-accent"
      >
        {row.fullName}
      </Link>
    ),
  },
  {
    key: 'views',
    header: '访问量',
    align: 'right',
    sortValue: (row) => row.views,
    render: (row) => <span className="tabular">{compact(row.views)}</span>,
  },
  {
    key: 'clones',
    header: '克隆量',
    align: 'right',
    sortValue: (row) => row.clones,
    render: (row) => <span className="tabular">{compact(row.clones)}</span>,
  },
  {
    key: 'cloneRate',
    header: '克隆率',
    align: 'right',
    sortValue: (row) => row.cloneRate,
    render: (row) => <span className="tabular">{pct(row.cloneRate)}</span>,
  },
  {
    key: 'commits',
    header: '提交数',
    align: 'right',
    sortValue: (row) => row.commits,
    render: (row) => <span className="tabular">{compact(row.commits)}</span>,
  },
  {
    key: 'stars',
    header: 'Stars',
    align: 'right',
    sortValue: (row) => row.stars,
    render: (row) => <span className="tabular">{compact(row.stars)}</span>,
  },
  {
    key: 'starDelta',
    header: 'Stars 增量',
    align: 'right',
    sortValue: (row) => row.starDelta,
    render: (row) => (
      <span className={row.starDelta > 0 ? 'tabular text-success' : 'tabular text-muted'}>
        {row.starDelta > 0 ? `+${num(row.starDelta)}` : num(row.starDelta)}
      </span>
    ),
  },
  {
    key: 'openIssues',
    header: '未关闭 Issue',
    align: 'right',
    sortValue: (row) => row.openIssues,
    render: (row) => <span className="tabular">{num(row.openIssues)}</span>,
  },
  {
    key: 'prMerged',
    header: 'PR 合并数',
    align: 'right',
    sortValue: (row) => row.prMerged,
    render: (row) => <span className="tabular">{compact(row.prMerged)}</span>,
  },
  {
    key: 'mergeRate',
    header: '合并率',
    align: 'right',
    sortValue: (row) => row.mergeRate,
    render: (row) => <span className="tabular">{pct(row.mergeRate)}</span>,
  },
  {
    key: 'healthScore',
    header: '健康度',
    align: 'right',
    width: '176px',
    sortValue: (row) => row.healthScore,
    render: (row) => (
      <span className="flex items-center justify-end gap-2">
        <span className="w-[84px] shrink-0">
          <ProgressBar value={row.healthScore} max={100} tone={healthTone(row.healthScore)} />
        </span>
        <span className="tabular w-7 shrink-0 text-right">{num(row.healthScore)}</span>
      </span>
    ),
  },
];

/** 对比指标矩阵（客户端包装：`columns[].render` 不能跨 RSC 边界）。 */
export function CompareMatrix({ rows }: { rows: RepoRankRow[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      rowKey={(row) => row.fullName}
      initialSortKey="views"
      initialSortDir="desc"
      empty={<EmptyState title="暂无可对比的仓库" description="在上方选择至少 1 个仓库。" />}
    />
  );
}

'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { cn, compact, num, pct } from '@/lib/format';
import type { RepoRankRow } from '@/lib/types';
import { healthTone, signedNum } from './helpers';

const BASE_COLUMNS: Column<RepoRankRow>[] = [
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

/** `codeByRepo` 缺失时的排序占位值：排在所有真实仓库之后。 */
const MISSING_SORT_VALUE = Number.NEGATIVE_INFINITY;

/** 代码量两列（估算行数 / 净增行数）：需要 `codeByRepo` 才插入矩阵。 */
function buildCodeColumns(
  codeByRepo: Record<string, { estimatedLines: number; net30d: number }>,
  days: number,
): Column<RepoRankRow>[] {
  return [
    {
      key: 'estimatedLines',
      header: '估算行数',
      align: 'right',
      sortValue: (row) => codeByRepo[row.fullName]?.estimatedLines ?? MISSING_SORT_VALUE,
      render: (row) => {
        const code = codeByRepo[row.fullName];
        if (!code) return <span className="text-muted">—</span>;
        return <span className="tabular">{compact(code.estimatedLines)}</span>;
      },
    },
    {
      key: 'net30d',
      header: `近 ${days} 天净增`,
      align: 'right',
      sortValue: (row) => codeByRepo[row.fullName]?.net30d ?? MISSING_SORT_VALUE,
      render: (row) => {
        const code = codeByRepo[row.fullName];
        if (!code) return <span className="text-muted">—</span>;
        return (
          <span
            className={cn(
              'tabular',
              code.net30d > 0 ? 'text-success' : code.net30d < 0 ? 'text-danger' : 'text-muted',
            )}
          >
            {signedNum(code.net30d)}
          </span>
        );
      },
    },
  ];
}

/**
 * 对比指标矩阵（客户端包装：`columns[].render` 不能跨 RSC 边界）。
 * 代码量两列由 `codeByRepo` 驱动（来自 `AggregateMetrics.code.perRepo`），缺省时不渲染。
 */
export function CompareMatrix({
  rows,
  codeByRepo,
  days = 30,
}: {
  rows: RepoRankRow[];
  codeByRepo?: Record<string, { estimatedLines: number; net30d: number }>;
  days?: number;
}) {
  const columns = useMemo<Column<RepoRankRow>[]>(() => {
    if (!codeByRepo) return BASE_COLUMNS;
    const anchor = BASE_COLUMNS.findIndex((column) => column.key === 'starDelta');
    const insertAt = anchor >= 0 ? anchor + 1 : BASE_COLUMNS.length;
    return [
      ...BASE_COLUMNS.slice(0, insertAt),
      ...buildCodeColumns(codeByRepo, days),
      ...BASE_COLUMNS.slice(insertAt),
    ];
  }, [codeByRepo, days]);

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.fullName}
      initialSortKey="views"
      initialSortDir="desc"
      empty={<EmptyState title="暂无可对比的仓库" description="在上方选择至少 1 个仓库。" />}
    />
  );
}

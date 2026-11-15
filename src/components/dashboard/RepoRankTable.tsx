'use client';

import Link from 'next/link';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { compact, pct } from '@/lib/format';
import type { RepoRankRow } from '@/lib/types';

/** 后端契约里 fullName 形如 owner/name；两段分别编码后再拼路径。 */
function detailHref(fullName: string): string {
  return `/repos/${fullName
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
}

function healthTone(score: number): 'good' | 'warn' | 'danger' {
  if (score >= 70) return 'good';
  if (score >= 45) return 'warn';
  return 'danger';
}

const columns: Column<RepoRankRow>[] = [
  {
    key: 'fullName',
    header: '仓库',
    sortValue: (row) => row.fullName,
    render: (row) => (
      <Link
        href={detailHref(row.fullName)}
        title={row.fullName}
        className="block max-w-[260px] truncate text-[13px] text-text hover:text-accent"
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
    render: (row) => compact(row.views),
  },
  {
    key: 'clones',
    header: '克隆量',
    align: 'right',
    sortValue: (row) => row.clones,
    render: (row) => compact(row.clones),
  },
  {
    key: 'cloneRate',
    header: '克隆率',
    align: 'right',
    sortValue: (row) => row.cloneRate,
    render: (row) => pct(row.cloneRate),
  },
  {
    key: 'commits',
    header: '提交',
    align: 'right',
    sortValue: (row) => row.commits,
    render: (row) => compact(row.commits),
  },
  {
    key: 'prMerged',
    header: 'PR 合并数',
    align: 'right',
    sortValue: (row) => row.prMerged,
    render: (row) => compact(row.prMerged),
  },
  {
    key: 'openIssues',
    header: '未关闭 Issue',
    align: 'right',
    sortValue: (row) => row.openIssues,
    render: (row) => compact(row.openIssues),
  },
  {
    key: 'healthScore',
    header: '健康度',
    align: 'right',
    width: '150px',
    sortValue: (row) => row.healthScore,
    render: (row) => (
      <div className="flex items-center justify-end gap-2">
        <span className="tabular text-[12px]">{row.healthScore}</span>
        <div className="w-14 shrink-0">
          <ProgressBar value={row.healthScore} max={100} tone={healthTone(row.healthScore)} />
        </div>
      </div>
    ),
  },
];

/**
 * 仓库排行表。
 * `DataTable` 是客户端组件且 `columns[].render` 是函数，无法跨 RSC 边界传递，
 * 因此在客户端组件内部定义列，只从服务端接收纯数据（RepoRankRow[]）。
 */
export function RepoRankTable({ rows }: { rows: RepoRankRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.fullName}
      initialSortKey="views"
      initialSortDir="desc"
      empty={<span className="text-[12px] text-muted">区间内没有可比较的仓库数据</span>}
    />
  );
}

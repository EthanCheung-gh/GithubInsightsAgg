'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SyncButton } from '@/components/ui/SyncButton';
import { compact, relTime } from '@/lib/format';
import type { RepoSummary } from '@/lib/types';
import { RepoActions } from './RepoActions';

function detailHref(fullName: string): string {
  return `/repos/${fullName
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
}

function statusCell(repo: RepoSummary): ReactNode {
  if (repo.lastSyncError) {
    return (
      <span title={repo.lastSyncError}>
        <Badge tone="danger">同步异常</Badge>
      </span>
    );
  }
  if (!repo.lastSyncedAt) return <Badge tone="neutral">未同步</Badge>;
  return (
    <span
      title={repo.lastSyncedAt}
      // 相对时间依赖“当前时刻”，SSR 与注水时的毫秒差可能跨过文案边界
      suppressHydrationWarning
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-muted"
    >
      <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
      已同步 · {relTime(repo.lastSyncedAt)}
    </span>
  );
}

const columns: Column<RepoSummary>[] = [
  {
    key: 'fullName',
    header: '仓库',
    sortValue: (row) => row.fullName,
    render: (row) => (
      <div className="min-w-[180px] max-w-[320px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href={detailHref(row.fullName)}
            title={row.fullName}
            className="truncate text-[13px] font-medium text-text hover:text-accent"
          >
            {row.fullName}
          </Link>
          {row.isPrivate ? <Badge tone="neutral">私有</Badge> : null}
          {row.isArchived ? <Badge tone="warn">归档</Badge> : null}
          {row.enabled ? null : <Badge tone="neutral">已停用</Badge>}
        </div>
        {row.description ? (
          <p className="mt-0.5 truncate text-[11px] text-muted" title={row.description}>
            {row.description}
          </p>
        ) : null}
      </div>
    ),
  },
  {
    key: 'language',
    header: '语言',
    sortValue: (row) => row.language ?? '',
    render: (row) => (row.language ? <Badge tone="info">{row.language}</Badge> : <span className="text-subtle">—</span>),
  },
  {
    key: 'stars',
    header: 'Stars',
    align: 'right',
    sortValue: (row) => row.stars,
    render: (row) => compact(row.stars),
  },
  {
    key: 'forks',
    header: 'Forks',
    align: 'right',
    sortValue: (row) => row.forks,
    render: (row) => compact(row.forks),
  },
  {
    key: 'openIssues',
    header: '未关闭 Issue',
    align: 'right',
    sortValue: (row) => row.openIssues,
    render: (row) => compact(row.openIssues),
  },
  {
    key: 'status',
    header: '状态',
    width: '170px',
    sortValue: (row) => row.lastSyncedAt ?? '',
    render: (row) => statusCell(row),
  },
  {
    key: 'actions',
    header: '操作',
    width: '250px',
    render: (row) => (
      <div className="flex flex-wrap items-start justify-end gap-1.5">
        <SyncButton fullName={row.fullName} label="同步" variant="ghost" size="sm" />
        <RepoActions id={row.id} enabled={row.enabled} fullName={row.fullName} />
      </div>
    ),
  },
];

/**
 * 仓库列表。
 * 列定义（含 render 函数）只能存在于客户端组件内部；服务端只传 `RepoSummary[]` 纯数据。
 */
export function RepoTable({ rows }: { rows: RepoSummary[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => String(row.id)}
      initialSortKey="stars"
      initialSortDir="desc"
      empty={<span className="text-[12px] text-muted">还没有添加仓库</span>}
    />
  );
}

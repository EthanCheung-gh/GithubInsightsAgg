'use client';

import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { shortDate } from '@/lib/format';
import type { ReleaseRow } from '@/lib/types';

const COLUMNS: Column<ReleaseRow>[] = [
  {
    key: 'tagName',
    header: 'Tag',
    width: '28%',
    sortValue: (row) => row.tagName,
    render: (row) => <span className="tabular font-medium text-text">{row.tagName}</span>,
  },
  {
    key: 'name',
    header: '名称',
    render: (row) => <span className="block max-w-[280px] truncate text-muted">{row.name ?? '—'}</span>,
  },
  {
    key: 'publishedAt',
    header: '发布时间',
    align: 'right',
    sortValue: (row) => row.publishedAt ?? '',
    render: (row) => <span className="tabular text-muted">{shortDate(row.publishedAt)}</span>,
  },
  {
    key: 'isPrerelease',
    header: '状态',
    align: 'right',
    width: '88px',
    render: (row) =>
      row.isPrerelease ? <Badge tone="warn">预发布</Badge> : <span className="text-subtle">正式</span>,
  },
];

/** 发布列表（客户端包装：`columns[].render` 不能跨 RSC 边界）。 */
export function ReleaseTable({ rows }: { rows: ReleaseRow[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      rowKey={(row) => row.tagName}
      dense
      empty={<EmptyState title="暂无发布记录" description="该仓库还没有可读取的 Release。" />}
    />
  );
}

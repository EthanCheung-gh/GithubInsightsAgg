'use client';

import { useMemo } from 'react';
import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { num } from '@/lib/format';
import type { ContributorRow } from '@/lib/types';

const COLUMNS: Column<ContributorRow>[] = [
  {
    key: 'login',
    header: '贡献者',
    render: (row) => (
      <span className="flex items-center gap-2">
        {row.avatarUrl ? (
          // 头像来自 avatars.githubusercontent.com：用原生 img + no-referrer，避免 next/image 远程域名配置
          <img
            src={row.avatarUrl}
            alt=""
            width={24}
            height={24}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-6 w-6 shrink-0 rounded-full border border-border bg-surface-2 object-cover"
          />
        ) : (
          <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-[10px] uppercase text-muted">
            {row.login.slice(0, 1)}
          </span>
        )}
        <span className="truncate font-medium text-text">{row.login}</span>
      </span>
    ),
  },
  {
    key: 'type',
    header: '类型',
    width: '96px',
    sortValue: (row) => row.type,
    render: (row) => (row.type === 'Bot' ? <Badge tone="info">Bot</Badge> : <Badge>{row.type}</Badge>),
  },
  {
    key: 'contributions',
    header: '提交数',
    align: 'right',
    width: '96px',
    sortValue: (row) => row.contributions,
    render: (row) => <span className="tabular">{num(row.contributions)}</span>,
  },
];

/** 贡献者表（客户端包装）：按 submissions 降序取 Top 20。 */
export function ContributorTable({ rows }: { rows: ContributorRow[] }) {
  const top = useMemo(
    () => [...rows].sort((a, b) => b.contributions - a.contributions).slice(0, 20),
    [rows],
  );

  return (
    <DataTable
      columns={COLUMNS}
      rows={top}
      rowKey={(row) => row.login}
      dense
      initialSortKey="contributions"
      initialSortDir="desc"
      empty={<EmptyState title="暂无贡献者数据" description="同步该仓库后会拉取贡献者列表。" />}
    />
  );
}

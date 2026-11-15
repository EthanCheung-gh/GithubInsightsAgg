'use client';

import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { num, pct } from '@/lib/format';
import type { CodeLanguageStat } from '@/lib/types';

const COLUMNS: Column<CodeLanguageStat>[] = [
  {
    key: 'language',
    header: '语言',
    width: '34%',
    sortValue: (row) => row.language,
    render: (row) => (
      <span className="block max-w-[220px] truncate font-medium text-text">{row.language}</span>
    ),
  },
  {
    key: 'bytes',
    header: '字节',
    align: 'right',
    sortValue: (row) => row.bytes,
    render: (row) => <span className="tabular">{num(row.bytes)}</span>,
  },
  {
    key: 'lines',
    header: '估算行数',
    align: 'right',
    sortValue: (row) => row.lines,
    render: (row) => <span className="tabular">{num(row.lines)}</span>,
  },
  {
    key: 'percent',
    header: '占比',
    align: 'right',
    width: '148px',
    sortValue: (row) => row.percent,
    render: (row) => (
      <span className="flex items-center justify-end gap-2">
        <span className="w-[64px] shrink-0">
          <ProgressBar value={row.percent} max={1} />
        </span>
        <span className="tabular w-12 shrink-0 text-right">{pct(row.percent)}</span>
      </span>
    ),
  },
];

/**
 * 语言明细表（客户端包装：`columns[].render` 不能跨 RSC 边界）。
 * 行序沿用数据层给出的「估算行数降序」，这里不再重排。
 */
export function CodeLanguageTable({ rows }: { rows: CodeLanguageStat[] }) {
  if (rows.length === 0) {
    return <EmptyState title="暂无语言明细" description="同步该仓库后会按语言字节数估算行数。" />;
  }

  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      rowKey={(row) => row.language}
      dense
      empty={<EmptyState title="暂无语言明细" description="同步该仓库后会按语言字节数估算行数。" />}
    />
  );
}

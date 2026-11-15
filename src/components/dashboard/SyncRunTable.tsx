'use client';

import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { num, relTime } from '@/lib/format';
import type { SyncRunRow } from '@/lib/types';

type Tone = 'neutral' | 'good' | 'warn' | 'danger' | 'info';

const STATUS_META: Record<SyncRunRow['status'], { label: string; tone: Tone }> = {
  success: { label: '成功', tone: 'good' },
  partial: { label: '部分成功', tone: 'warn' },
  error: { label: '失败', tone: 'danger' },
  running: { label: '进行中', tone: 'info' },
};

function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.trunc(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

const columns: Column<SyncRunRow>[] = [
  {
    key: 'startedAt',
    header: '时间',
    sortValue: (row) => row.startedAt,
    render: (row) => (
      <span
        className="tabular whitespace-nowrap text-[12px] text-muted"
        title={row.startedAt}
        // 相对时间依赖“当前时刻”，SSR 与注水时的毫秒差可能跨过文案边界
        suppressHydrationWarning
      >
        {relTime(row.startedAt)}
      </span>
    ),
  },
  {
    key: 'scope',
    header: '范围',
    sortValue: (row) => row.repoFullName ?? '全部',
    render: (row) => (
      <span className="block max-w-[220px] truncate" title={row.repoFullName ?? '全部'}>
        {row.repoFullName ?? '全部'}
      </span>
    ),
  },
  {
    key: 'status',
    header: '状态',
    width: '110px',
    sortValue: (row) => row.status,
    render: (row) => {
      const meta = STATUS_META[row.status];
      return <Badge tone={meta.tone}>{meta.label}</Badge>;
    },
  },
  {
    key: 'mode',
    header: '模式',
    width: '90px',
    sortValue: (row) => row.mode,
    render: (row) => (
      <span className="text-[12px] text-muted">{row.mode === 'live' ? '实时' : '演示'}</span>
    ),
  },
  {
    key: 'durationMs',
    header: '耗时',
    align: 'right',
    sortValue: (row) => row.durationMs ?? 0,
    render: (row) => formatDuration(row.durationMs),
  },
  {
    key: 'recordsWritten',
    header: '写入行数',
    align: 'right',
    sortValue: (row) => row.recordsWritten,
    render: (row) => num(row.recordsWritten),
  },
  {
    key: 'error',
    header: '错误',
    render: (row) =>
      row.error ? (
        <span className="block max-w-[260px] truncate text-[12px] text-danger" title={row.error}>
          {row.error}
        </span>
      ) : (
        <span className="text-subtle">—</span>
      ),
  },
];

/**
 * 同步记录表（总览/设置页复用）。
 * 服务端只传 `SyncRunRow[]`；列定义留在客户端组件内。
 */
export function SyncRunTable({ runs }: { runs: SyncRunRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={runs}
      rowKey={(row) => String(row.id)}
      initialSortKey="startedAt"
      initialSortDir="desc"
      dense
      empty={<span className="text-[12px] text-muted">还没有同步记录</span>}
    />
  );
}

'use client';

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/format';
import { EmptyState } from './EmptyState';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right';
  width?: string;
  sortValue?: (row: T) => number | string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  dense = false,
  initialSortKey,
  initialSortDir = 'desc',
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  dense?: boolean;
  initialSortKey?: string;
  initialSortDir?: 'asc' | 'desc';
}) {
  const [sortKey, setSortKey] = useState<string | null>(initialSortKey ?? null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSortDir);

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const getValue = columns.find((column) => column.key === sortKey)?.sortValue;
    if (!getValue) return rows;

    const factor = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (typeof va === 'number' && typeof vb === 'number') {
        const na = Number.isFinite(va) ? va : 0;
        const nb = Number.isFinite(vb) ? vb : 0;
        return (na - nb) * factor;
      }
      return String(va).localeCompare(String(vb), 'zh-CN') * factor;
    });
  }, [rows, columns, sortKey, sortDir]);

  function handleSort(key: string) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir('desc');
  }

  return (
    <div className="scroll-thin w-full overflow-x-auto">
      <table className={cn('table', dense && 'table--dense')}>
        <thead>
          <tr>
            {columns.map((column) => {
              const sortable = typeof column.sortValue === 'function';
              const active = sortKey === column.key;
              return (
                <th
                  key={column.key}
                  style={column.width ? { width: column.width } : undefined}
                  className={cn(column.align === 'right' && 'text-right')}
                  aria-sort={
                    active ? (sortDir === 'asc' ? 'ascending' : 'descending') : sortable ? 'none' : undefined
                  }
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => handleSort(column.key)}
                      className={cn(
                        'inline-flex items-center gap-1 transition-colors hover:text-text',
                        active && 'text-text',
                      )}
                    >
                      {column.header}
                      <span aria-hidden className="text-[9px] leading-none">
                        {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="p-0">
                {empty ?? <EmptyState title="暂无数据" />}
              </td>
            </tr>
          ) : (
            sortedRows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      column.align === 'right' && 'text-right',
                      column.align === 'right' && 'tabular',
                    )}
                  >
                    {column.render ? column.render(row) : String((row as Record<string, unknown>)[column.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

'use client';

import { useMemo } from 'react';
import { compact } from '@/lib/format';
import { Chart } from './Chart';
import {
  axisStyle,
  chartBase,
  compactLabel,
  escapeHtml,
  suffixLabel,
  useChartPalette,
} from './echarts-setup';
import type { EChartsOption } from './echarts-setup';
import type { BarSeriesOption } from 'echarts/charts';

/** 横向排行榜条形图：按 value 降序，只取前 maxRows 条，右端直出数值。 */
export function RankBarChart({
  rows,
  height,
  valueSuffix,
  maxRows = 8,
}: {
  rows: { label: string; value: number; hint?: string }[];
  height?: number;
  valueSuffix?: string;
  maxRows?: number;
}) {
  const palette = useChartPalette();

  const option = useMemo<EChartsOption>(() => {
    const visible = [...rows].sort((a, b) => b.value - a.value).slice(0, Math.max(1, maxRows));
    const labels = visible.map((row) => row.label);

    // 提示信息按轴顺序（category + inverse）对齐到 dataIndex
    const hints = visible.map((row) => row.hint ?? '');

    const seriesOption: BarSeriesOption = {
      type: 'bar',
      name: 'value',
      data: visible.map((row, index) => ({
        value: row.value,
        itemStyle: {
          color: palette.series[index % palette.series.length],
          borderRadius: [0, 3, 3, 0],
        },
      })),
      barMaxWidth: 16,
      label: {
        show: true,
        position: 'right',
        color: palette.textMuted,
        fontSize: 11,
        formatter: (params: unknown) => {
          const p = params as { value?: unknown };
          return suffixLabel(p.value, valueSuffix);
        },
      },
      emphasis: { focus: 'series' },
    };

    return {
      ...chartBase(palette),
      grid: { left: 4, right: 52, top: 6, bottom: 2, containLabel: true },
      tooltip: {
        ...chartBase(palette).tooltip,
        trigger: 'item',
        formatter: (params: unknown) => {
          const p = params as { name?: string; value?: unknown; dataIndex?: number };
          const hint = hints[p.dataIndex ?? -1];
          const head = `<div style="font-weight:600;margin-bottom:2px">${escapeHtml(p.name ?? '')}</div>`;
          const value = `<div>${escapeHtml(compact(Number(p.value ?? 0)))}${escapeHtml(valueSuffix ?? '')}</div>`;
          const tail = hint
            ? `<div style="color:${escapeHtml(palette.textMuted)};margin-top:2px">${escapeHtml(hint)}</div>`
            : '';
          return head + value + tail;
        },
      },
      xAxis: {
        type: 'value',
        ...axisStyle(palette),
        axisLine: { show: false },
        axisLabel: {
          color: palette.textMuted,
          fontSize: 11,
          formatter: (value: unknown) => compactLabel(value),
        },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: labels,
        ...axisStyle(palette),
        splitLine: { show: false },
        axisLabel: {
          color: palette.text,
          fontSize: 11,
          width: 120,
          overflow: 'truncate',
        },
      },
      series: [seriesOption],
    };
  }, [rows, valueSuffix, maxRows, palette]);

  const resolvedHeight = height ?? Math.max(120, Math.min(rows.length, maxRows) * 30);

  return <Chart option={option} height={resolvedHeight} />;
}

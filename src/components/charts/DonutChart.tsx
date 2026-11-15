'use client';

import { useMemo } from 'react';
import { Chart } from './Chart';
import { chartBase, compactLabel, escapeHtml, useChartPalette } from './echarts-setup';
import type { EChartsOption } from './echarts-setup';
import type { PieSeriesOption } from 'echarts/charts';

/**
 * 「其他」合并项的中性色：优先读 `--text-subtle`（未包含在 ChartPalette 里），
 * 取不到时退回 `--text-muted`。中性灰而不是 `--chart-N`，避免"其他"抢占系列色语义。
 */
function subtleColor(fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return '#6e7681';
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue('--text-subtle')
    .trim();
  return value || fallback;
}

/**
 * 环形图：语言占比、来源构成一类。中心用 title 显示主数值 + 说明。
 * 图例放底部（契约允许右侧或底部）——这样 `title.left:'center'` 始终与环心对齐。
 *
 * `maxSlices`：可选的扇区上限。窄卡片里条目太多时 ECharts 的滚动图例会退化成
 * “◀ 1/2 ▶”分页箭头（观感像坏掉），因此超限的部分合并成一项「其他」，
 * 并配合 `legend.type:'plain'`（换行而不是分页）。不传该 prop 时行为完全不变。
 */
export function DonutChart({
  rows,
  height,
  centerLabel,
  centerValue,
  maxSlices,
}: {
  rows: { label: string; value: number; color?: string }[];
  height?: number;
  centerLabel?: string;
  centerValue?: string;
  maxSlices?: number;
}) {
  const palette = useChartPalette();

  const option = useMemo<EChartsOption>(() => {
    const limit =
      maxSlices !== undefined && Number.isFinite(maxSlices) && maxSlices > 0
        ? Math.floor(maxSlices)
        : 0;

    // 不限制或未超限：按原顺序直出，颜色仍按 `--chart-N` 循环。
    const sliced =
      limit === 0 || rows.length <= limit
        ? rows.map((row, index) => ({
            name: row.label,
            value: row.value,
            itemStyle: { color: row.color ?? palette.series[index % palette.series.length] },
          }))
        : [
            ...rows.slice(0, limit - 1).map((row, index) => ({
              name: row.label,
              value: row.value,
              itemStyle: { color: row.color ?? palette.series[index % palette.series.length] },
            })),
            {
              name: '其他',
              value: rows.slice(limit - 1).reduce((sum, row) => sum + row.value, 0),
              itemStyle: { color: subtleColor(palette.textMuted) },
            },
          ];

    const seriesOption: PieSeriesOption = {
      type: 'pie',
      radius: ['58%', '80%'],
      center: ['50%', '44%'],
      avoidLabelOverlap: true,
      label: { show: false },
      labelLine: { show: false },
      itemStyle: {
        borderWidth: 2,
        borderColor: palette.surface,
      },
      data: sliced,
      emphasis: {
        scaleSize: 4,
        itemStyle: { borderColor: palette.surface },
      },
    };

    return {
      ...chartBase(palette),
      title:
        centerValue !== undefined || centerLabel !== undefined
          ? {
              text: centerValue ?? '',
              subtext: centerLabel ?? '',
              left: 'center',
              top: '38%',
              textStyle: {
                color: palette.text,
                fontSize: 20,
                fontWeight: 600,
                fontFamily:
                  'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
              },
              subtextStyle: { color: palette.textMuted, fontSize: 11 },
              itemGap: 4,
            }
          : undefined,
      tooltip: {
        ...chartBase(palette).tooltip,
        trigger: 'item',
        formatter: (params: unknown) => {
          const p = params as { name?: string; value?: unknown; percent?: number };
          return `${escapeHtml(p.name ?? '')}<br/>${escapeHtml(compactLabel(p.value))} · ${escapeHtml(
            `${(p.percent ?? 0).toFixed(1)}%`,
          )}`;
        },
      },
      legend: {
        bottom: 0,
        left: 'center',
        // 'plain' 超宽时换行（视觉上仍然完整），'scroll' 会渲染 ◀ 1/2 ▶ 分页箭头。
        type: 'plain',
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 10,
        textStyle: { color: palette.textMuted, fontSize: 11 },
      },
      series: [seriesOption],
    };
  }, [rows, centerLabel, centerValue, palette, maxSlices]);

  return <Chart option={option} height={height} />;
}

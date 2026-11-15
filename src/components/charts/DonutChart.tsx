'use client';

import { useMemo } from 'react';
import { Chart } from './Chart';
import { chartBase, compactLabel, escapeHtml, useChartPalette } from './echarts-setup';
import type { EChartsOption } from './echarts-setup';
import type { PieSeriesOption } from 'echarts/charts';

/**
 * 环形图：语言占比、来源构成一类。中心用 title 显示主数值 + 说明。
 * 图例放底部（契约允许右侧或底部）——这样 `title.left:'center'` 始终与环心对齐。
 */
export function DonutChart({
  rows,
  height,
  centerLabel,
  centerValue,
}: {
  rows: { label: string; value: number; color?: string }[];
  height?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const palette = useChartPalette();

  const option = useMemo<EChartsOption>(() => {
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
      data: rows.map((row, index) => ({
        name: row.label,
        value: row.value,
        itemStyle: { color: row.color ?? palette.series[index % palette.series.length] },
      })),
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
        type: 'scroll',
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 12,
        textStyle: { color: palette.textMuted, fontSize: 11 },
      },
      series: [seriesOption],
    };
  }, [rows, centerLabel, centerValue, palette]);

  return <Chart option={option} height={height} />;
}

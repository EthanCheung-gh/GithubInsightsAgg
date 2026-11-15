'use client';

import { useMemo } from 'react';
import { Chart } from './Chart';
import { axisStyle, chartBase, compactLabel, useChartPalette } from './echarts-setup';
import type { EChartsOption } from './echarts-setup';
import type { BarSeriesOption } from 'echarts/charts';

/** 星期分布柱状图：7 根柱，柱顶直出数值（提交活跃度的周内分布）。 */
export function WeekdayBarChart({
  rows,
  height,
}: {
  rows: { label: string; value: number }[];
  height?: number;
}) {
  const palette = useChartPalette();

  const option = useMemo<EChartsOption>(() => {
    const seriesOption: BarSeriesOption = {
      type: 'bar',
      name: 'value',
      data: rows.map((row, index) => ({
        value: row.value,
        itemStyle: {
          color: palette.series[index % palette.series.length],
          borderRadius: [3, 3, 0, 0],
        },
      })),
      barMaxWidth: 34,
      label: {
        show: true,
        position: 'top',
        color: palette.textMuted,
        fontSize: 11,
        formatter: (params: unknown) => {
          const p = params as { value?: unknown };
          return compactLabel(p.value);
        },
      },
      emphasis: { focus: 'series' },
    };

    return {
      ...chartBase(palette),
      grid: { left: 4, right: 8, top: 22, bottom: 2, containLabel: true },
      tooltip: {
        ...chartBase(palette).tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: palette.surface } },
      },
      xAxis: {
        type: 'category',
        data: rows.map((row) => row.label),
        ...axisStyle(palette),
        splitLine: { show: false },
        axisLabel: { color: palette.textMuted, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        ...axisStyle(palette),
        axisLine: { show: false },
        axisLabel: {
          color: palette.textMuted,
          fontSize: 11,
          formatter: (value: unknown) => compactLabel(value),
        },
      },
      series: [seriesOption],
    };
  }, [rows, palette]);

  return <Chart option={option} height={height} />;
}

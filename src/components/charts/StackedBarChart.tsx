'use client';

import { useMemo } from 'react';
import { shortDate } from '@/lib/format';
import { Chart } from './Chart';
import { axisStyle, chartBase, useChartPalette } from './echarts-setup';
import type { EChartsOption } from './echarts-setup';
import type { BarSeriesOption } from 'echarts/charts';

/** 堆叠柱状图：issues / PR / commits 一类按类别堆叠的日序列。 */
export function StackedBarChart({
  data,
  series,
  height,
}: {
  data: { date: string; [k: string]: number | string }[];
  series: { key: string; label: string; color?: string }[];
  height?: number;
}) {
  const palette = useChartPalette();

  const option = useMemo<EChartsOption>(() => {
    const dates = data.map((row) => shortDate(row.date));

    const seriesOption = series.map((item, index): BarSeriesOption => {
      const color = item.color ?? palette.series[index % palette.series.length];
      return {
        type: 'bar',
        name: item.label,
        stack: 'total',
        data: data.map((row) => Number(row[item.key] ?? 0)),
        barMaxWidth: 18,
        itemStyle: { color, borderRadius: [2, 2, 0, 0] },
        emphasis: { focus: 'series' },
      };
    });

    return {
      ...chartBase(palette),
      grid: { left: 4, right: 12, top: series.length > 1 ? 30 : 12, bottom: 2, containLabel: true },
      legend:
        series.length > 1
          ? {
              top: 0,
              right: 0,
              type: 'scroll',
              icon: 'circle',
              itemWidth: 8,
              itemHeight: 8,
              itemGap: 12,
              textStyle: { color: palette.textMuted, fontSize: 11 },
            }
          : undefined,
      tooltip: {
        ...chartBase(palette).tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: palette.surface } },
      },
      xAxis: {
        type: 'category',
        boundaryGap: true,
        data: dates,
        ...axisStyle(palette),
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        ...axisStyle(palette),
        axisLine: { show: false },
      },
      series: seriesOption,
    };
  }, [data, series, palette]);

  return <Chart option={option} height={height} />;
}

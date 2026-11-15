'use client';

import { useMemo } from 'react';
import { shortDate } from '@/lib/format';
import { Chart } from './Chart';
import { areaGradient, axisStyle, chartBase, suffixLabel, useChartPalette } from './echarts-setup';
import type { EChartsOption } from './echarts-setup';
import type { BarSeriesOption, LineSeriesOption } from 'echarts/charts';

/** 通用趋势图：按 `date` 取横轴，line / bar 混合，line 可用面积渐变。 */
export function TrendChart({
  data,
  series,
  height,
  valueSuffix,
}: {
  data: { date: string; [k: string]: number | string }[];
  series: { key: string; label: string; color?: string; area?: boolean; type?: 'line' | 'bar' }[];
  height?: number;
  valueSuffix?: string;
}) {
  const palette = useChartPalette();

  const option = useMemo<EChartsOption>(() => {
    const dates = data.map((row) => shortDate(row.date));
    const hasLegend = series.length > 1;

    const seriesOption = series.map((item, index): LineSeriesOption | BarSeriesOption => {
      const color = item.color ?? palette.series[index % palette.series.length];
      const values = data.map((row) => Number(row[item.key] ?? 0));

      if ((item.type ?? 'line') === 'bar') {
        return {
          type: 'bar',
          name: item.label,
          data: values,
          barMaxWidth: 18,
          itemStyle: { color, borderRadius: [2, 2, 0, 0] },
          emphasis: { focus: 'series' },
        };
      }

      return {
        type: 'line',
        name: item.label,
        data: values,
        smooth: 0.25,
        showSymbol: false,
        symbolSize: 4,
        lineStyle: { width: 1.8, color },
        itemStyle: { color },
        emphasis: { focus: 'series' },
        areaStyle: item.area ? { color: areaGradient(color) } : undefined,
      };
    });

    return {
      ...chartBase(palette),
      grid: { left: 4, right: 12, top: hasLegend ? 30 : 12, bottom: 2, containLabel: true },
      legend: hasLegend
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
        axisPointer: { type: 'line', lineStyle: { color: palette.borderStrong, width: 1 } },
        valueFormatter: (value: unknown) => suffixLabel(value, valueSuffix),
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: dates,
        ...axisStyle(palette),
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        ...axisStyle(palette),
        axisLine: { show: false },
        axisLabel: {
          color: palette.textMuted,
          fontSize: 11,
          formatter: (value: unknown) => suffixLabel(value, valueSuffix),
        },
      },
      series: seriesOption,
    };
  }, [data, series, valueSuffix, palette]);

  return <Chart option={option} height={height} />;
}

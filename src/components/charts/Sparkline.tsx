'use client';

import { useMemo } from 'react';
import { Chart } from './Chart';
import { areaGradient, chartBase, useChartPalette } from './echarts-setup';
import type { EChartsOption } from './echarts-setup';
import type { LineSeriesOption } from 'echarts/charts';

/** 迷你折线：KPI 卡里的趋势点缀，无轴、无 tooltip、无图例。 */
export function Sparkline({
  values,
  height,
  color,
}: {
  values: number[];
  height?: number;
  color?: string;
}) {
  const palette = useChartPalette();

  const option = useMemo<EChartsOption>(() => {
    const lineColor = color ?? palette.series[0];
    const seriesOption: LineSeriesOption = {
      type: 'line',
      data: values,
      smooth: 0.25,
      showSymbol: false,
      lineStyle: { width: 1.5, color: lineColor },
      itemStyle: { color: lineColor },
      areaStyle: { color: areaGradient(lineColor, 0.22, 0) },
    };

    return {
      ...chartBase(palette),
      grid: { left: 0, right: 0, top: 0, bottom: 0, containLabel: false },
      xAxis: {
        type: 'category',
        show: false,
        boundaryGap: false,
        data: values.map((_, index) => index),
      },
      yAxis: { type: 'value', show: false, scale: true },
      tooltip: { show: false },
      legend: { show: false },
      series: [seriesOption],
    };
  }, [values, color, palette]);

  return <Chart option={option} height={height ?? 36} />;
}

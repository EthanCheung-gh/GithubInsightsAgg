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

/**
 * 估算标签的显示宽度：ASCII 记 1 个显示单位，非 ASCII（中文等宽字符）记 2。
 * 11px 字号下一个显示单位约 7px，用于给 Y 轴标签列算宽度预算。
 */
function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += char.codePointAt(0)! < 0x80 ? 1 : 2;
  }
  return width;
}

/** 每显示单位占的像素（11px 字号 + 默认字体栈下的经验值）。 */
const LABEL_UNIT_PX = 7;
/** 标签列宽度预算上限：再长就交给 ellipsis 截断，避免把绘图区压得过窄。 */
const LABEL_BUDGET_MAX = 240;
/** 标签列左右各留的呼吸余量。 */
const LABEL_PADDING = 16;
/**
 * zrender 在一个**离屏** canvas 上量文本（containLabel 用它算预留宽度），
 * 而实际绘制发生在页面内的 canvas 上；Chromium 对 `-apple-system, ...` 这串字体栈
 * 的两种解析结果宽度差约 9%（实测「demo/nebula-api」量出 82px、画出来 89.5px）。
 * 于是 containLabel 会**少留**这一截，最长的那个标签被推到 grid.left 之外、被画布裁掉首字符。
 * 这里按预算的 12% 补一段动态余量（夹在 8~32px）兜住这个误差，同时充当视觉留白。
 */
const GRID_LEFT_GUTTER_MIN = 8;
const GRID_LEFT_GUTTER_MAX = 32;
const GRID_LEFT_GUTTER_RATIO = 0.12;

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

    // 按最长标签的显示宽度估算标签列预算；超长标签（如 EthanCheung-gh/MetricStudio）
    // 由 axisLabel.width + overflow:'truncate' 优雅省略，而不是被画布裁掉首字符。
    const longestLabel = labels.reduce((max, label) => Math.max(max, displayWidth(label)), 0);
    const labelBudget = Math.min(
      LABEL_BUDGET_MAX,
      Math.max(40, longestLabel * LABEL_UNIT_PX + LABEL_PADDING),
    );
    // `grid.left` 只是画布左边缘到标签列的外侧留白；标签列本身由 containLabel 追加，
    // 因此这里不能放整份预算（会和实测宽度叠加，把绘图区压到 1/3 以下）。
    const gridLeft = Math.min(
      GRID_LEFT_GUTTER_MAX,
      Math.max(GRID_LEFT_GUTTER_MIN, Math.round(labelBudget * GRID_LEFT_GUTTER_RATIO)),
    );

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
      grid: {
        left: gridLeft,
        right: 52,
        top: 6,
        bottom: 2,
        containLabel: true,
      },
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
          // 标签列变宽（长仓库名）后绘图区会变窄，刻度文案可能互相压住：让 ECharts 只保留
          // 放得下的刻度，正常宽度下没有任何刻度被判为重叠，渲染结果不变。
          hideOverlap: true,
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
          // 预算内的宽度上限：命中上限才触发省略号截断，短标签不受影响。
          width: Math.max(24, labelBudget - LABEL_PADDING),
          overflow: 'truncate',
          ellipsis: '…',
        },
      },
      series: [seriesOption],
    };
  }, [rows, valueSuffix, maxRows, palette]);

  const resolvedHeight = height ?? Math.max(120, Math.min(rows.length, maxRows) * 30);

  return <Chart option={option} height={resolvedHeight} />;
}

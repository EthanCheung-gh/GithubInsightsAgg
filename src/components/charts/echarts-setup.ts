'use client';

/**
 * ECharts 按需注册与主题色的集中配置。
 *
 * 设计要点（契约 §8 / CONTRACTS 增补）：
 * - 不用 echarts 内置 'dark' 主题：所有颜色都从 globals.css 的 CSS 变量实时读取，
 *   因此亮/暗主题切换时图表颜色自动跟随。
 * - 只注册项目实际用到的 chart / component / renderer，避免把整包 echarts 打进分包。
 */

import { useEffect, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
// echarts 6 把 `grid.containLabel` 降级为 legacy 特性，必须先注册它，
// 否则 containLabel 会被静默忽略（坐标轴标签会被裁掉）。契约要求使用 containLabel。
import { LegacyGridContainLabel } from 'echarts/features';
import { compact } from '@/lib/format';
import type { ComposeOption } from 'echarts/core';
import type { BarSeriesOption, LineSeriesOption, PieSeriesOption } from 'echarts/charts';
import type {
  GridComponentOption,
  LegendComponentOption,
  MarkLineComponentOption,
  TitleComponentOption,
  TooltipComponentOption,
} from 'echarts/components';

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  MarkLineComponent,
  CanvasRenderer,
  LegacyGridContainLabel,
]);

export { echarts };

/** 注册后本项目的 option 类型（组件 props 里声明的 `EChartsOption` 即此类型）。 */
export type EChartsOption = ComposeOption<
  | LineSeriesOption
  | BarSeriesOption
  | PieSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | TitleComponentOption
  | MarkLineComponentOption
>;

export const CHART_ANIMATION_DURATION = 320;

const CHART_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

/** 与 `:root`（暗色默认主题）完全一致的兜底值：SSR 阶段与首帧使用，避免颜色闪烁。 */
const DARK_FALLBACK_PALETTE: ChartPalette = {
  series: ['#4493f8', '#3fb950', '#bc8cff', '#d29922', '#39c5cf', '#f778ba'],
  text: '#e6edf3',
  textMuted: '#9198a1',
  border: '#262d38',
  borderStrong: '#3d444d',
  surface: '#161b22',
  bgElevated: '#161b22',
  accent: '#4493f8',
  success: '#3fb950',
  warn: '#d29922',
  danger: '#f85149',
};

export interface ChartPalette {
  /** `--chart-1..6` 按顺序排列，图表按系列下标取色 */
  series: string[];
  text: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  surface: string;
  bgElevated: string;
  accent: string;
  success: string;
  warn: string;
  danger: string;
}

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * 从 `document.documentElement` 读取当前主题的 CSS 变量。
 * SSR / 无 document 环境返回与暗色令牌一致的兜底值。
 */
export function getChartPalette(): ChartPalette {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return DARK_FALLBACK_PALETTE;
  }
  const styles = window.getComputedStyle(document.documentElement);
  const fallback = DARK_FALLBACK_PALETTE;
  return {
    series: fallback.series.map((color, index) =>
      readVar(styles, `--chart-${index + 1}`, color),
    ),
    text: readVar(styles, '--text', fallback.text),
    textMuted: readVar(styles, '--text-muted', fallback.textMuted),
    border: readVar(styles, '--border', fallback.border),
    borderStrong: readVar(styles, '--border-strong', fallback.borderStrong),
    surface: readVar(styles, '--surface', fallback.surface),
    bgElevated: readVar(styles, '--bg-elevated', fallback.bgElevated),
    accent: readVar(styles, '--accent', fallback.accent),
    success: readVar(styles, '--success', fallback.success),
    warn: readVar(styles, '--warn', fallback.warn),
    danger: readVar(styles, '--danger', fallback.danger),
  };
}

/**
 * 调色板 hook：挂载后读取真实主题色，并监听 `<html data-theme>` 变化后重新取值，
 * 使图表 option 重建 → 换主题时线条/柱体颜色跟着变。
 */
export function useChartPalette(): ChartPalette {
  const [palette, setPalette] = useState<ChartPalette>(() => getChartPalette());

  useEffect(() => {
    setPalette(getChartPalette());
    const target = document.documentElement;
    const observer = new MutationObserver(() => setPalette(getChartPalette()));
    observer.observe(target, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return palette;
}

/** hex / rgb(a) 颜色加透明度，用于面积渐变。无法解析时原样返回。 */
export function withAlpha(color: string, alpha: number): string {
  const value = color.trim();
  const clamped = Math.min(1, Math.max(0, alpha));

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const expand = (h: string) =>
      h.length === 3
        ? h
            .split('')
            .map((c) => c + c)
            .join('')
        : h;
    const full = expand(hex.slice(0, hex.length === 8 ? 8 : undefined));
    if (/^[0-9a-fA-F]{6}$/.test(full)) {
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${clamped})`;
    }
  }

  const rgbMatch = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(/[,/\s]+/).filter(Boolean);
    if (parts.length >= 3) {
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${clamped})`;
    }
  }

  return value;
}

/** ECharts 线性渐变对象（与 LinearGradientObject 结构一致，避免引入 zrender 类型）。 */
export interface ChartGradient {
  type: 'linear';
  x: number;
  y: number;
  x2: number;
  y2: number;
  colorStops: { offset: number; color: string }[];
  global?: boolean;
}

/** 自上而下的面积渐变：系列色 28% → 0%。 */
export function areaGradient(color: string, from = 0.28, to = 0): ChartGradient {
  return {
    type: 'linear',
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: withAlpha(color, from) },
      { offset: 1, color: withAlpha(color, to) },
    ],
  };
}

/** 所有图表共用的基础配置：动画时长、字号、tooltip 配色。 */
export function chartBase(palette: ChartPalette) {
  return {
    animationDuration: CHART_ANIMATION_DURATION,
    textStyle: { fontSize: 11, fontFamily: CHART_FONT, color: palette.textMuted },
    tooltip: {
      backgroundColor: palette.bgElevated,
      borderColor: palette.border,
      borderWidth: 1,
      padding: [6, 9] as [number, number],
      textStyle: { color: palette.text, fontSize: 11, fontFamily: CHART_FONT },
      extraCssText: `border-radius: 8px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);`,
    },
  };
}

/** 坐标轴通用样式：轴线/刻度用 --border，标签用 --text-muted。 */
export function axisStyle(palette: ChartPalette) {
  return {
    axisLine: { lineStyle: { color: palette.border } },
    axisTick: { show: false },
    axisLabel: { color: palette.textMuted, fontSize: 11, fontFamily: CHART_FONT },
    splitLine: { lineStyle: { color: palette.border, type: 'dashed' as const } },
  };
}

/** 统一的数值标签格式化：走 @/lib/format 的 compact（如 1.2万）。 */
export function compactLabel(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? compact(n) : String(value);
}

/** 数值 + 单位后缀（如 '次' / '%'）。 */
export function suffixLabel(value: unknown, suffix?: string): string {
  return `${compactLabel(value)}${suffix ?? ''}`;
}

/** tooltip 内联 HTML 转义（标签/提示可能来自仓库数据，避免注入）。 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

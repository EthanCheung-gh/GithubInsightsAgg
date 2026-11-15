'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/format';
import { echarts } from './echarts-setup';
import type { EChartsOption } from './echarts-setup';
import type { EChartsType } from 'echarts/core';

/**
 * ECharts 画布容器：负责 init / setOption / resize / dispose。
 * 所有派生图表（TrendChart 等）都只是把 props 翻译成 option 后交给本组件渲染。
 */
export function Chart({
  option,
  height,
  className,
  loading,
}: {
  option: EChartsOption;
  height?: number;
  className?: string;
  loading?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);
  // 供主题切换回调复用最新的 option（避免把 option 塞进 mount effect 的依赖）
  const optionRef = useRef<EChartsOption>(option);
  optionRef.current = option;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = echarts.init(host, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    chart.setOption(optionRef.current, { notMerge: true });

    const resize = () => chart.resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    // 切主题时 CSS 变量变了，但 series 颜色已烘焙进已有 option：
    // 重新 setOption + resize，配合 useChartPalette() 触发的 option 重建即可完整换色。
    const themeObserver = new MutationObserver(() => {
      chart.resize();
      chart.setOption(optionRef.current, { notMerge: true });
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      chartRef.current = null;
      chart.dispose();
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(option, { notMerge: true });
  }, [option]);

  return (
    <div className={cn('relative w-full', className)} style={{ height: height ?? 280 }}>
      <div ref={hostRef} className="h-full w-full" />
      {loading ? (
        <div className="skeleton absolute inset-0" aria-hidden />
      ) : null}
    </div>
  );
}

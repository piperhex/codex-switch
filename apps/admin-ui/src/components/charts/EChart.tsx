import { useEffect, useRef } from "react";
import type { ECharts, EChartsCoreOption } from "echarts/core";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface EChartProps {
  option: EChartsCoreOption;
  dark: boolean;
  ariaLabel: string;
  className?: string;
}

export function EChart({ option, dark, ariaLabel, className }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const chart = echarts.init(containerRef.current, dark ? "dark" : undefined, {
      renderer: "canvas",
    });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [dark]);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return (
    <div
      ref={containerRef}
      className={className}
      role="img"
      aria-label={ariaLabel}
    />
  );
}

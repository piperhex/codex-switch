import { useEffect, useRef } from "react";
import { init } from "echarts/core";
import type { EChartsCoreOption as EChartsOption, EChartsType } from "echarts/core";
import styles from "./index.module.less";

interface EChartProps {
  option: EChartsOption;
  label: string;
  className?: keyof typeof styles;
  preserveZoomKey?: string;
}

interface ChartZoomRange {
  startValue: number;
  endValue: number;
}

function readZoomRange(chart: EChartsType): ChartZoomRange | null {
  const zoom = chart.getOption().dataZoom;
  if (!Array.isArray(zoom) || !zoom[0] || typeof zoom[0] !== "object") return null;
  const { startValue, endValue } = zoom[0] as Partial<ChartZoomRange>;
  if (typeof startValue !== "number" || typeof endValue !== "number") return null;
  return Number.isFinite(startValue) && Number.isFinite(endValue) ? { startValue, endValue } : null;
}

function withZoomRange(option: EChartsOption, range: ChartZoomRange | null) {
  if (!range || !Array.isArray(option.dataZoom)) return option;
  const dataZoom = option.dataZoom.map((zoom: unknown) => (
    zoom && typeof zoom === "object" ? { ...zoom, ...range } : zoom
  ));
  return { ...option, dataZoom };
}

export function EChart({ option, label, className, preserveZoomKey }: EChartProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const zoomRef = useRef<ChartZoomRange | null>(null);
  const zoomKeyRef = useRef<string>();

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return undefined;
    const chart = init(element, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    chart.on("datazoom", () => {
      if (zoomKeyRef.current !== undefined) zoomRef.current = readZoomRange(chart);
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (zoomKeyRef.current !== preserveZoomKey) zoomRef.current = null;
    zoomKeyRef.current = preserveZoomKey;
    // Render zoom views before they can be replaced or disposed during rapid navigation.
    chart.setOption(withZoomRange(option, zoomRef.current), {
      notMerge: true, lazyUpdate: preserveZoomKey === undefined,
    });
  }, [option, preserveZoomKey]);

  return <div ref={elementRef} className={`${styles.tokenEchart} ${className ? styles[className] : ""}`}
    role="img" aria-label={label} />;
}

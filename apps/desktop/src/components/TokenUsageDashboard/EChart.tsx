import { useEffect, useRef } from "react";
import { init } from "echarts/core";
import type { EChartsCoreOption as EChartsOption, EChartsType } from "echarts/core";
import styles from "./index.module.less";

interface EChartProps {
  option: EChartsOption;
  label: string;
  className?: keyof typeof styles;
}

export function EChart({ option, label, className }: EChartProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return undefined;
    const chart = init(element, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option]);

  return <div ref={elementRef} className={`${styles.tokenEchart} ${className ? styles[className] : ""}`}
    role="img" aria-label={label} />;
}

import { useLayoutEffect, useState, type RefObject } from "react";

export const MAX_ACCOUNT_PICKER_WIDTH = 400;
const VIEWPORT_MARGIN = 24;

export function useAccountPickerWidth(trigger: RefObject<HTMLButtonElement>, active: boolean) {
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const element = trigger.current;
    if (!active || !element) return;
    const measure = () => {
      const measured = element.getBoundingClientRect().width;
      if (measured <= 0) return;
      const available = Math.max(0, window.innerWidth - VIEWPORT_MARGIN);
      setWidth(Math.min(measured, MAX_ACCOUNT_PICKER_WIDTH, available));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [active, trigger]);
  return width;
}

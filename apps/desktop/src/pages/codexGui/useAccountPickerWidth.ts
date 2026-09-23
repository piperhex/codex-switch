import { useLayoutEffect, useState } from "react";

export const MAX_ACCOUNT_PICKER_WIDTH = 400;
const VIEWPORT_MARGIN = 24;

export function useAccountPickerWidth(active: boolean) {
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    if (!active) return;
    const measure = () => {
      const available = Math.max(0, window.innerWidth - VIEWPORT_MARGIN);
      setWidth(Math.min(MAX_ACCOUNT_PICKER_WIDTH, available));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);
  return width;
}

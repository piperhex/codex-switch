import { useCallback, useEffect, useState } from "react";
import { loadAppSettings, updateBubbleResetDisplay } from "../api/backend";
import type { BubbleResetDisplay } from "../types";

export function useBubbleResetDisplay(notify: (message: string) => void) {
  const [display, setDisplay] = useState<BubbleResetDisplay>("countdown");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void loadAppSettings()
      .then((settings) => {
        if (active) setDisplay(settings.bubbleResetDisplay);
      })
      .catch((error) => notify(String(error)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [notify]);

  const updateDisplay = useCallback(async (nextDisplay: BubbleResetDisplay) => {
    const previous = display;
    setDisplay(nextDisplay);
    setLoading(true);
    try {
      const settings = await updateBubbleResetDisplay(nextDisplay);
      setDisplay(settings.bubbleResetDisplay);
    } catch (error) {
      setDisplay(previous);
      notify(String(error));
    } finally {
      setLoading(false);
    }
  }, [display, notify]);

  return { display, loading, setDisplay: updateDisplay };
}

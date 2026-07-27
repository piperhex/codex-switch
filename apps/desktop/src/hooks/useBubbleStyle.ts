import { useCallback, useEffect, useState } from "react";
import { loadAppSettings, updateBubbleStyle } from "../api/backend";
import type { BubbleStyle } from "../types";

export function useBubbleStyle(notify: (message: string) => void) {
  const [style, setStyle] = useState<BubbleStyle>("classic");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void loadAppSettings()
      .then((settings) => {
        if (active) setStyle(settings.bubbleStyle);
      })
      .catch((error) => notify(String(error)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [notify]);

  const setBubbleStyle = useCallback(async (nextStyle: BubbleStyle) => {
    const previous = style;
    setStyle(nextStyle);
    setLoading(true);
    try {
      const settings = await updateBubbleStyle(nextStyle);
      setStyle(settings.bubbleStyle);
    } catch (error) {
      setStyle(previous);
      notify(String(error));
    } finally {
      setLoading(false);
    }
  }, [notify, style]);

  return { style, loading, setStyle: setBubbleStyle };
}

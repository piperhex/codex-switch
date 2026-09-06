import { useEffect, useState } from "react";
import {
  loadLongContextCostSettings, LONG_CONTEXT_COST_EVENT, LONG_CONTEXT_COST_STORAGE_KEY,
} from "../../utils/tokenCostLongContext";

export function useLongContextThreshold() {
  const [threshold, setThreshold] = useState(() => loadLongContextCostSettings().thresholdTokens);
  useEffect(() => {
    const update = () => setThreshold(loadLongContextCostSettings().thresholdTokens);
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === LONG_CONTEXT_COST_STORAGE_KEY) update();
    };
    window.addEventListener(LONG_CONTEXT_COST_EVENT, update);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LONG_CONTEXT_COST_EVENT, update);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return threshold;
}

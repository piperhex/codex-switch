import { useCallback, useEffect, useRef, useState } from "react";
import { syncCodexNotification } from "../api/backend";

export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number>();

  const notify = useCallback((nextMessage: string) => {
    window.clearTimeout(timer.current);
    setMessage(nextMessage);
    timer.current = window.setTimeout(() => setMessage(null), 3400);
    void syncCodexNotification(nextMessage).catch(() => {
      console.debug("Codex notification mirror is unavailable.");
    });
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { message, notify };
}

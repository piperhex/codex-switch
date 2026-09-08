import { useEffect, useRef, useState } from "react";

const CATCH_UP_MS = 120;
const MIN_CHARACTERS_PER_MS = 0.06;

// Animate only newly received text. Opening an existing conversation must show its history immediately.
export function useStreamingText(text: string, streaming: boolean) {
  const [visible, setVisible] = useState(text);
  const displayed = useRef(text);

  useEffect(() => {
    if (!streaming || !text.startsWith(displayed.current) || document.hidden) {
      displayed.current = text;
      setVisible(text);
      return;
    }
    if (displayed.current === text) return;

    let position = displayed.current.length;
    let previousTime = performance.now();
    const speed = Math.max((text.length - position) / CATCH_UP_MS, MIN_CHARACTERS_PER_MS);
    let frame: number;
    const reveal = (now: number) => {
      position = Math.min(text.length, position + (now - previousTime) * speed);
      previousTime = now;
      let end = Math.floor(position);
      // Never render half of a UTF-16 surrogate pair, including emoji in a streamed reply.
      if (end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
      displayed.current = text.slice(0, end);
      setVisible(displayed.current);
      if (position < text.length) frame = requestAnimationFrame(reveal);
    };
    const showWhenHidden = () => {
      if (!document.hidden) return;
      cancelAnimationFrame(frame);
      displayed.current = text;
      setVisible(text);
    };
    frame = requestAnimationFrame(reveal);
    document.addEventListener("visibilitychange", showWhenHidden);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", showWhenHidden);
    };
  }, [text, streaming]);

  // Completion, interruption, and authoritative replacements should never show stale text for a frame.
  return streaming && text.startsWith(visible) ? visible : text;
}

import { useEffect, useRef, useState } from "react";

const CATCH_UP_MS = 120;
const MIN_CHARACTERS_PER_MS = 0.06;
const ANIMATION_CHARACTER_LIMIT = 8_000;
const CHARACTERS_PER_INTERVAL = 32_000;
const LONG_TEXT_INTERVAL_MS = 250;
const MAX_TEXT_INTERVAL_MS = 1_000;

// Animate only newly received text. Opening an existing conversation must show its history immediately.
export function useStreamingText(text: string, streaming: boolean) {
  const [visible, setVisible] = useState(text);
  const displayed = useRef(text);
  const previousText = useRef(text);
  const publishedAt = useRef(0);
  const replaced = !text.startsWith(previousText.current);

  useEffect(() => {
    previousText.current = text;
    const publish = (value: string) => {
      displayed.current = value;
      publishedAt.current = performance.now();
      setVisible(value);
    };
    if (!streaming || replaced || !text.startsWith(displayed.current) || document.hidden) {
      publish(text);
      return;
    }
    if (displayed.current === text) return;

    let position = displayed.current.length;
    let previousTime = performance.now();
    const speed = Math.max((text.length - position) / CATCH_UP_MS, MIN_CHARACTERS_PER_MS);
    let frame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reveal = (now: number) => {
      position = Math.min(text.length, position + (now - previousTime) * speed);
      previousTime = now;
      let end = Math.floor(position);
      // Never render half of a UTF-16 surrogate pair, including emoji in a streamed reply.
      if (end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
      publish(text.slice(0, end));
      if (position < text.length) frame = requestAnimationFrame(reveal);
    };
    const showWhenHidden = () => {
      if (!document.hidden) return;
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(timer);
      publish(text);
    };
    if (text.length >= ANIMATION_CHARACTER_LIMIT) {
      const interval = Math.min(MAX_TEXT_INTERVAL_MS,
        Math.ceil(text.length / CHARACTERS_PER_INTERVAL) * LONG_TEXT_INTERVAL_MS);
      // Measure from the last publication, not the latest delta: continuous input cannot starve rendering.
      const delay = Math.max(0, interval - (performance.now() - publishedAt.current));
      timer = setTimeout(() => publish(text), delay);
    } else {
      frame = requestAnimationFrame(reveal);
    }
    document.addEventListener("visibilitychange", showWhenHidden);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", showWhenHidden);
    };
  }, [text, streaming, replaced]);

  // Completion, interruption, and authoritative replacements should never show stale text for a frame.
  return streaming && !replaced && text.startsWith(visible) ? visible : text;
}

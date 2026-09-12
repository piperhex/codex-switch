import type { KeyboardEvent } from "react";

export function submitQuestionOnEnter(event: KeyboardEvent, submit: () => Promise<unknown>) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing
    || event.nativeEvent.keyCode === 229) return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) void submit();
}

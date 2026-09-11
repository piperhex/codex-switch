import { useRef, type UIEvent, type WheelEvent } from "react";
import type { GuiController } from "./controller";
import type { GuiState } from "./types";

const LOAD_AHEAD_PX = 120;

export function useThreadPagination({ state, controller, enabled }: {
  state: GuiState; controller: GuiController; enabled: boolean;
}) {
  const pending = useRef(false);
  const previousTop = useRef(0);
  const loadNearBottom = async (node: HTMLDivElement) => {
    if (!enabled || !state.cursor || state.loading || state.connection !== "ready" || pending.current) return;
    if (node.clientHeight <= 0 || node.scrollHeight - node.scrollTop - node.clientHeight > LOAD_AHEAD_PX) return;
    pending.current = true;
    try { await controller.refresh(true); }
    finally { pending.current = false; }
  };
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    const scrollingDown = node.scrollTop > previousTop.current;
    previousTop.current = node.scrollTop;
    if (scrollingDown) void loadNearBottom(node);
  };
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    // Collapsed groups can leave too few rows to produce a scroll event.
    if (event.deltaY > 0) void loadNearBottom(event.currentTarget);
  };
  return { onScroll, onWheel };
}

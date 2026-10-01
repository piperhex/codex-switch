import { guiText } from "../../i18n/guiText";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Item, Turn } from "./types";
import { TurnDuration } from "./TurnDuration";
import { WorkItems } from "./WorkItems";
import styles from "./styles.module.less";

export { hasVisibleProcessContent } from "../../../../../shared/chat/processContent";

export function TurnProcess({ turn, items, running, active, timed }: {
  turn: Turn; items: Item[]; running: boolean; active: boolean; timed: boolean;
}) {
  const automaticOpen = running || turn.status === "interrupted" || turn.status === "failed";
  const [state, setState] = useState({ automaticOpen, open: automaticOpen, inspected: false });
  if (state.automaticOpen !== automaticOpen) {
    // Only automatically opened work collapses on completion; preserve the reader's explicit choice.
    setState({ ...state, automaticOpen, open: state.inspected ? state.open : automaticOpen });
  }
  return <details className={styles.workGroup} open={state.open} onToggle={(event) => {
    if (event.target !== event.currentTarget) {
      // Inspecting a nested command also counts as choosing to keep this process visible.
      if ((event.target as HTMLDetailsElement).open) setState((current) => ({ ...current, inspected: true }));
      return;
    }
    if (event.currentTarget.open === state.open) return;
    setState({ automaticOpen, open: event.currentTarget.open, inspected: true });
  }}>
    <summary data-history-anchor aria-label={guiText("处理过程，{value1} 项活动", { value1: items.length })}>
      {timed ? <TurnDuration turn={turn} running={running} active={active} fallback={guiText("处理过程")} inline />
        : <span>{guiText("处理过程")}</span>}
      <ChevronRight size={14} aria-hidden="true" />
    </summary>
    {state.open && <WorkItems items={items} startedAt={turn.startedAt} running={running} />}
  </details>;
}

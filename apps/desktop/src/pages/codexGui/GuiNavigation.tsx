import { Clock3, Package, SquarePen } from "lucide-react";
import styles from "./GuiNavigation.module.less";

export type GuiView = "conversation" | "scheduled-tasks" | "plugins";

export const GUI_VIEW_TITLES: Record<GuiView, string> = {
  conversation: "Codex GUI", "scheduled-tasks": "定时任务", plugins: "插件",
};

export function GuiNavigation({ view, sending, onNavigate, onNewConversation,
  scheduledTasksAvailable = true }: {
  scheduledTasksAvailable?: boolean;
  view: GuiView; sending: boolean; onNavigate: (view: GuiView) => void; onNewConversation: () => void;
}) {
  return <nav className={styles.navigation} aria-label="Codex GUI 导航">
    <button type="button" disabled={sending} onClick={onNewConversation}>
      <SquarePen size={18} strokeWidth={1.6} aria-hidden="true" /><span>新对话</span>
    </button>
    {scheduledTasksAvailable && <button type="button" aria-current={view === "scheduled-tasks" ? "page" : undefined}
      onClick={() => onNavigate("scheduled-tasks")}>
      <Clock3 size={18} strokeWidth={1.6} aria-hidden="true" /><span>定时任务</span>
    </button>}
    <button type="button" aria-current={view === "plugins" ? "page" : undefined}
      onClick={() => onNavigate("plugins")}>
      <Package size={18} strokeWidth={1.6} aria-hidden="true" /><span>插件</span>
    </button>
  </nav>;
}

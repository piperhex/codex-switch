import { guiText } from "../../i18n/guiText";
import { Clock3, FolderInput, Package, SquarePen } from "lucide-react";
import styles from "./GuiNavigation.module.less";

export type GuiView = "conversation" | "scheduled-tasks" | "plugins" | "conversation-migration";

export const GUI_VIEW_TITLES: Record<GuiView, string> = {
  conversation: "Codex GUI", get "scheduled-tasks"() { return guiText("定时任务"); }, get plugins() { return guiText("插件"); },
  get "conversation-migration"() { return guiText("对话迁移"); },
};

export function GuiNavigation({ view, sending, onNavigate, onNewConversation,
  scheduledTasksAvailable = true }: {
  scheduledTasksAvailable?: boolean;
  view: GuiView; sending: boolean; onNavigate: (view: GuiView) => void; onNewConversation: () => void;
}) {
  return <nav className={styles.navigation} aria-label={guiText("Codex GUI 导航")}>
    <button type="button" disabled={sending} onClick={onNewConversation}>
      <SquarePen size={18} strokeWidth={1.6} aria-hidden="true" /><span>{guiText("新对话")}</span>
    </button>
    {scheduledTasksAvailable && <button type="button" aria-current={view === "scheduled-tasks" ? "page" : undefined}
      onClick={() => onNavigate("scheduled-tasks")}>
      <Clock3 size={18} strokeWidth={1.6} aria-hidden="true" /><span>{guiText("定时任务")}</span>
    </button>}
    <button type="button" aria-current={view === "plugins" ? "page" : undefined}
      onClick={() => onNavigate("plugins")}>
      <Package size={18} strokeWidth={1.6} aria-hidden="true" /><span>{guiText("插件")}</span>
    </button>
    <button type="button" aria-current={view === "conversation-migration" ? "page" : undefined}
      onClick={() => onNavigate("conversation-migration")}>
      <FolderInput size={18} strokeWidth={1.6} aria-hidden="true" /><span>{guiText("对话迁移")}</span>
    </button>
  </nav>;
}

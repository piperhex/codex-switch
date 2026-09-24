import { GUI_CODEX_HOME_ID } from "../../types";
import { CodexThreadsPage } from "../CodexThreadsPage";
import { getGuiController } from "./session";
import styles from "./GuiMigrationPage.module.less";

const EXCLUDED_SOURCE_HOMES = [GUI_CODEX_HOME_ID];

function refreshMigratedConversations(targetHomeId: string) {
  if (targetHomeId === GUI_CODEX_HOME_ID) void getGuiController().refresh();
}

export default function GuiMigrationPage({ active, notify }: {
  active: boolean;
  notify: (message: string) => void;
}) {
  return <section className={styles.page} aria-label="对话迁移">
    <CodexThreadsPage language="zh" notify={notify} active={active} embedded
      excludedHomeIds={EXCLUDED_SOURCE_HOMES} onHomeMigrated={refreshMigratedConversations} />
  </section>;
}

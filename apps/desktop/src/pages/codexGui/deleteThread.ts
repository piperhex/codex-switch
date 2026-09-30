import { invoke } from "../../api/backend";
import type { CodexThreadMutationReport } from "../../types";

export interface GuiDeletionReport extends CodexThreadMutationReport {
  deletedThreadIds: string[];
}

export async function deleteGuiThread(id: string) {
  return invoke<GuiDeletionReport>("codex_gui_delete_thread", { threadId: id });
}

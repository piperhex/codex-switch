import { invoke } from "../../api/backend";
import type { CodexThreadMutationReport } from "../../types";

export async function deleteGuiThread(id: string) {
  return invoke<CodexThreadMutationReport>("codex_gui_delete_thread", { threadId: id });
}

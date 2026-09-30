import { invoke } from "@tauri-apps/api/core";
import type { FileReference } from "../fileReference";

export type PreviewKind = "html" | "markdown" | "text" | "image" | "pdf" | "video" | "audio";
export interface FilePreviewData extends FileReference {
  sessionId: string;
  name: string;
  kind: PreviewKind;
  text: string | null;
  url: string;
}
export const filePreviewApi = {
  open: (target: FileReference & { threadId: string | null }) =>
    invoke<FilePreviewData | null>("codex_gui_open_file_preview", { target }),
  close: (sessionId: string) => invoke<void>("codex_gui_close_file_preview", { sessionId }),
};

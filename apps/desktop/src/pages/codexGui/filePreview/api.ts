import { invoke } from "@tauri-apps/api/core";
import type { FileReference } from "../fileReference";

export type PreviewKind = "html" | "markdown" | "text" | "image" | "pdf" | "video" | "audio";
export interface FilePreviewData extends FileReference {
  name: string;
  kind: PreviewKind;
  text: string | null;
  url: string;
}
export const filePreviewApi = {
  open: (target: FileReference & { threadId: string | null }) =>
    invoke<boolean>("codex_gui_open_file_preview", { target }),
  read: () => invoke<FilePreviewData>("codex_gui_read_file_preview"),
};

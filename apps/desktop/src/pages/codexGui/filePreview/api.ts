import { invoke, isHostedWebApp } from "../../../api/backend";
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
  open: async (target: FileReference & { threadId: string | null }) => {
    const data = await invoke<FilePreviewData | null>("codex_gui_open_file_preview", { target });
    // Resolve against the listener, including when it is reached from another computer.
    return data && isHostedWebApp ? { ...data, url: new URL(data.url, window.location.origin).href } : data;
  },
  close: (sessionId: string) => invoke<void>("codex_gui_close_file_preview", { sessionId }),
};

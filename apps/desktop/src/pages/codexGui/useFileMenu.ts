import { useContext, useEffect, useRef, useState } from "react";
import { message } from "antd";
import { isTauri } from "@tauri-apps/api/core";
import { fileApi, FileThreadContext, type FileAction, type FileApplication } from "./fileApi";
import type { FileReference } from "./fileReference";

const FEEDBACK_STYLE = { maxWidth: 400, marginInline: "auto" };

export function useFileMenu(target: FileReference) {
  const threadId = useContext(FileThreadContext);
  const desktop = isTauri();
  const [open, setOpen] = useState(false);
  const [applications, setApplications] = useState<FileApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  useEffect(() => {
    setOpen(false);
  }, [target.path, threadId]);
  useEffect(() => {
    if (!open || !desktop) return;
    let cancelled = false;
    setLoading(true); setFailed(false);
    void fileApi.applications().then((value) => { if (!cancelled) setApplications(value); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, desktop]);
  const perform = async (action: FileAction) => {
    if (flight.current) return;
    flight.current = true; setBusy(true); setOpen(false);
    try {
      const result = desktop ? await fileApi.perform({ ...target, threadId }, action)
        : { path: target.path, text: undefined, saved: false };
      if (action.type === "copyPath" || action.type === "copyContents") {
        await navigator.clipboard.writeText(action.type === "copyPath" ? result.path : result.text ?? "");
        void message.success({ content: "已复制", style: FEEDBACK_STYLE });
      }
      if (action.type === "saveAs" && result.saved) {
        void message.success({ content: "文件已保存", style: FEEDBACK_STYLE });
      }
    } catch (error) {
      // Native errors are intentionally limited to friendly messages at the IPC boundary.
      void message.error({ content: typeof error === "string" ? error : "操作未完成，请稍后重试。",
        style: FEEDBACK_STYLE });
    } finally { flight.current = false; setBusy(false); }
  };
  return { open, setOpen, applications, desktop, loading, failed, busy, perform };
}

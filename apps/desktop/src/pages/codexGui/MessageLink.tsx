import type { ReactNode } from "react";
import { message } from "antd";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export function MessageLink({ href, children }: { href?: string; children?: ReactNode }) {
  if (!href || !/^https?:\/\//i.test(href)) return <span>{children}</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => {
    // Browser navigation must stay native, including Ctrl/Cmd-click and the link context menu.
    if (!isTauri()) return;
    event.preventDefault();
    void openUrl(href).catch(() => { void message.error({
      content: "链接暂时无法打开，请稍后重试。", style: { maxWidth: 400, marginInline: "auto" },
    }); });
  }}>{children}</a>;
}

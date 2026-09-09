import type { ReactNode } from "react";
import { message } from "antd";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CopyButton } from "./CopyButton";
import { WebsiteIcon } from "./WebsiteIcon";
import { MessageImage } from "./MessageImage";
import { localImageSource } from "./imageSources";
import styles from "./MessageLink.module.less";

export function isFileReference(href: string) {
  return /^(?:[a-z]:[\\/]|\/[^/]|\.\.?[\\/])/i.test(href) && !/^\/__codex_switch__\//.test(href);
}

export function MessageLink({ href, children }: { href?: string; children?: ReactNode }) {
  if (href && localImageSource(href)) return <MessageImage src={href}
    alt={typeof children === "string" ? children : "图片"} />;
  if (href && isFileReference(href)) return <span className={styles.fileReference}>
    <span>{children}</span><CopyButton text={href} label="复制文件路径" />
  </span>;
  if (!href || !/^https?:\/\//i.test(href)) return <span>{children}</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => {
    // Browser navigation must stay native, including Ctrl/Cmd-click and the link context menu.
    if (!isTauri()) return;
    event.preventDefault();
    void openUrl(href).catch(() => { void message.error({
      content: "链接暂时无法打开，请稍后重试。", style: { maxWidth: 400, marginInline: "auto" },
    }); });
  }}><WebsiteIcon key={href} href={href} />{children}</a>;
}

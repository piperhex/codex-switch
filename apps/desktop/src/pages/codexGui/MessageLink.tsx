import { useContext, type ReactNode } from "react";
import { message } from "antd";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FileMenu } from "./FileMenu";
import { parseFileReference } from "./fileReference";
import { WebsiteIcon } from "./WebsiteIcon";
import { MessageImage } from "./MessageImage";
import { localImageSource } from "./imageSources";
import { DetailsContext } from "./detailsContext";

export { isFileReference } from "./fileReference";

function isWebsiteUrl(href: string | undefined): href is string {
  if (!href || !/^https?:\/\//i.test(href)) return false;
  try { return Boolean(new URL(href).hostname); } catch { return false; }
}

export function MessageLink({ href, children }: { href?: string; children?: ReactNode }) {
  const panel = useContext(DetailsContext);
  if (href && localImageSource(href)) return <MessageImage src={href}
    alt={typeof children === "string" ? children : "图片"} />;
  const file = href ? parseFileReference(href) : undefined;
  if (file) return <FileMenu {...file} preview>{children}</FileMenu>;
  if (!isWebsiteUrl(href)) return <span>{children}</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => {
    if (panel && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault(); panel.openWebsite(href); return;
    }
    // Explicit browser shortcuts and contexts without a details sidebar retain their original behavior.
    if (!isTauri()) return;
    event.preventDefault();
    void openUrl(href).catch(() => { void message.error({
      content: "链接暂时无法打开，请稍后重试。", style: { maxWidth: 400, marginInline: "auto" },
    }); });
  }}><WebsiteIcon key={href} href={href} />{children}</a>;
}

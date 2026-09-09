import { useState } from "react";
import { Globe } from "lucide-react";
import styles from "./MessageLink.module.less";

function faviconUrl(href: string) {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return new URL("/favicon.ico", url.origin).href;
  } catch {
    return undefined;
  }
}

export function WebsiteIcon({ href }: { href: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  const source = faviconUrl(href);
  return <span className={styles.websiteIcon} aria-hidden="true">
    {status !== "loaded" && <Globe size="100%" />}
    {source && status !== "failed" && <img
      className={styles.favicon}
      src={source}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      data-loaded={status === "loaded"}
      onLoad={() => setStatus("loaded")}
      onError={() => setStatus("failed")}
    />}
  </span>;
}

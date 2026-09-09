import { useState, type ReactNode } from "react";
import styles from "./ComposerCatalogIcon.module.less";

export function ComposerCatalogIcon({ urls, size, fallback }: {
  urls: (string | null | undefined)[]; size: number; fallback: ReactNode;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const url = urls.find((value): value is string => Boolean(value && !failed.includes(value)
    && (/^https:\/\//i.test(value) || /^data:image\/(png|jpeg|webp|svg\+xml);base64,/i.test(value))));
  if (!url) return fallback;
  return <img className={styles.image} src={url} width={size} height={size} alt="" referrerPolicy="no-referrer"
    onError={() => setFailed((values) => [...values, url])} />;
}

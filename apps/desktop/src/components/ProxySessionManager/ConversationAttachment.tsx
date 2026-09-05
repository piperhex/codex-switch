import { useEffect, useRef, useState } from "react";
import { Image, Spin } from "antd";
import { ImageOff } from "lucide-react";
import { loadProxyConversationAttachment } from "../../api/backend";
import type { Translate } from "../../i18n";
import type { ProxyConversationAttachment } from "../../types";
import styles from "./conversation.module.less";

interface Props {
  attachment: ProxyConversationAttachment;
  index: number;
  t: Translate;
}

function isImageSource(source: string): boolean {
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/.test(source)) return true;
  try {
    const url = new URL(source);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function ConversationAttachment({ attachment, index, t }: Props) {
  const container = useRef<HTMLElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const label = t("providers.proxy.conversationImage", { number: index + 1 });

  useEffect(() => {
    let cancelled = false;
    let started = false;
    setSource(null);
    setUnavailable(false);
    const load = async () => {
      if (started) return;
      started = true;
      try {
        const result = await loadProxyConversationAttachment(attachment.id);
        if (cancelled) return;
        if (result && isImageSource(result)) setSource(result);
        else setUnavailable(true);
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        void load();
      }
    });
    if (container.current) observer.observe(container.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [attachment.id]);

  return (
    <figure className={styles.attachment} ref={container}>
      {unavailable ? (
        <div className={styles.placeholder}>
          <ImageOff size={24} />
          <span>{t("providers.proxy.conversationImageUnavailable")}</span>
        </div>
      ) : source ? (
        <Image src={source} alt={label} width={128} height={96}
          referrerPolicy="no-referrer" onError={() => setUnavailable(true)} />
      ) : (
        <div className={styles.placeholder}><Spin size="small" /></div>
      )}
      <figcaption>{label}</figcaption>
    </figure>
  );
}

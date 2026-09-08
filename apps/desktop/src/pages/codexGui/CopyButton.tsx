import { useEffect, useState } from "react";
import { Button, message } from "antd";
import { Check, Copy } from "lucide-react";

const COPY_FEEDBACK_MS = 1800;

export function CopyButton({ text, label = "复制消息" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return <Button type="text" size="small" aria-label={copied ? "已复制" : label}
    icon={copied ? <Check size={14} /> : <Copy size={14} />}
    onClick={() => void navigator.clipboard.writeText(text)
      .then(() => setCopied(true)).catch(() => {
        setCopied(false);
        void message.error({ content: "复制失败，请选中文字后复制。", style: { maxWidth: 400, marginInline: "auto" } });
      })} />;
}

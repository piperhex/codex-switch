import { useEffect, useState } from "react";
import { Button } from "antd";
import { Check, Copy } from "lucide-react";

const COPY_FEEDBACK_MS = 1800;

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return <Button type="text" size="small" aria-label={copied ? "已复制" : "复制消息"}
    icon={copied ? <Check size={14} /> : <Copy size={14} />}
    onClick={() => void navigator.clipboard.writeText(text)
      .then(() => setCopied(true)).catch(() => setCopied(false))} />;
}

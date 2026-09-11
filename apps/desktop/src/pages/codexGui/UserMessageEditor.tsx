import { useRef, useState } from "react";
import { Button, Input } from "antd";
import styles from "./UserMessage.module.less";

export function UserMessageEditor({ text, disabled, onSubmit, onCancel }: {
  text: string; disabled: boolean; onSubmit: (text: string) => Promise<boolean>; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(text);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const submit = async () => {
    if (inFlight.current || disabled || !draft.trim()) return;
    inFlight.current = true;
    setSaving(true);
    try { if (await onSubmit(draft)) onCancel(); }
    finally { inFlight.current = false; setSaving(false); }
  };
  return <div className={styles.editor}>
    <Input.TextArea autoFocus aria-label="编辑消息内容" value={draft} disabled={saving}
      autoSize={{ minRows: 3, maxRows: 14 }} onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape" && !saving) { event.preventDefault(); onCancel(); }
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submit(); }
      }} />
    <p>将在当前对话中替换这条消息，并重新生成回复。</p>
    <div className={styles.editorActions}>
      <Button size="small" aria-label="取消编辑" disabled={saving} onClick={onCancel}>取消</Button>
      <Button size="small" type="primary" loading={saving} disabled={disabled || !draft.trim()}
        onClick={() => void submit()}>保存并发送</Button>
    </div>
  </div>;
}

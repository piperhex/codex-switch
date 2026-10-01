import { guiText } from "../../i18n/guiText";
import { useContext, useEffect, useRef, useState } from "react";
import { Button } from "antd";
import type { Content, SkillReference } from "./types";
import type { SubmitMessageEdit } from "./messageEditContent";
import { MessageEditorImages } from "./MessageEditorImages";
import { SkillInput, type SkillInputHandle } from "./SkillInput";
import { useMessageEditDraft } from "./useMessageEditDraft";
import { MessageEditContext } from "./messageEditContext";
import styles from "./UserMessage.module.less";

export function UserMessageEditor({ text, images, skills, disabled, onSubmit, onCancel }: {
  text: string; images: Content[]; skills: SkillReference[];
  disabled: boolean; onSubmit: SubmitMessageEdit; onCancel: () => void;
}) {
  const editor = useRef<SkillInputHandle>(null);
  const { cwd, active } = useContext(MessageEditContext);
  const draft = useMessageEditDraft({ text, images, skills });
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => { editor.current?.focus(); }, []);
  const submit = async () => {
    if (inFlight.current || disabled || !active || draft.reading || draft.isReading() || !draft.draft.text.trim()) return;
    inFlight.current = true;
    setSaving(true);
    try {
      if (await onSubmit(draft.content())) onCancel();
    }
    finally { inFlight.current = false; setSaving(false); }
  };
  return <div className={styles.editor}>
    <MessageEditorImages images={draft.images} removed={draft.removed} disabled={saving || disabled}
      onRemove={draft.remove} />
    <SkillInput ref={editor} value={draft.draft} draftKey="message-edit" cwd={cwd} active={active}
      connected={!disabled} disabled={saving || disabled} editing={{ onCancel, className: styles.editorInput }}
      placeholder={guiText("输入消息，或输入 / 选择技能…")} onChange={draft.setDraft} onPaste={draft.paste}
      onSend={() => void submit()} />
    {draft.error && <p className={styles.editorError} role="status">{draft.error}</p>}
    <div className={styles.editorActions}>
      <Button className={styles.cancelButton} autoInsertSpace={false} aria-label={guiText("取消编辑")}
        disabled={saving} onClick={onCancel}>{guiText("取消")}</Button>
      <Button className={styles.sendButton} autoInsertSpace={false} type="primary"
        loading={saving} disabled={disabled || draft.reading || !draft.draft.text.trim()}
        onClick={() => void submit()}>{guiText("发送")}</Button>
    </div>
  </div>;
}

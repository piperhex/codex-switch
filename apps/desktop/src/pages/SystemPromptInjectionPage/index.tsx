import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { Button, Input, Modal, Switch, Table, type TableColumnsType } from "antd";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import type { Translate } from "../../i18n";
import type { SystemPromptRule } from "../../types";
import styles from "./index.module.less";
import { type PromptEditor, usePromptEditor } from "./usePromptEditor";

const PROMPT_PREVIEW_CHAR_LIMIT = 200;
const TOPBAR_ACTIONS_ID = "system-prompt-injection-topbar-actions";

interface SystemPromptInjectionPageProps {
  enabled: boolean;
  loading: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onPromptsChange: (prompts: SystemPromptRule[]) => Promise<boolean>;
  prompts: SystemPromptRule[];
  t: Translate;
}

function promptPreview(value: string) {
  const characters = Array.from(value);
  return characters.length > PROMPT_PREVIEW_CHAR_LIMIT
    ? `${characters.slice(0, PROMPT_PREVIEW_CHAR_LIMIT).join("")}…`
    : value;
}

function PromptEditorModal({ editor, loading, t }: {
  editor: PromptEditor;
  loading: boolean;
  t: Translate;
}) {
  const isEditing = editor.editingIndex !== null;
  return (
    <Modal
      open={editor.modalOpen}
      title={t(isEditing ? "systemPromptInjection.editPrompt" : "systemPromptInjection.addPrompt")}
      okText={t("systemPromptInjection.savePrompt")}
      cancelText={t("systemPromptInjection.cancelEdit")}
      confirmLoading={loading}
      onCancel={editor.closeModal}
      onOk={() => void editor.savePrompt()}
    >
      <div className={styles.editorForm}>
        <label>
          <span>{t("systemPromptInjection.promptName")}</span>
          <Input autoFocus value={editor.draftName}
            onChange={(event) => editor.updateDraftName(event.target.value)}
            placeholder={t("systemPromptInjection.promptNamePlaceholder")} />
        </label>
        <label>
          <span>{t("systemPromptInjection.promptContent")}</span>
          <Input.TextArea className={styles.promptEditorTextArea} rows={10}
            value={editor.draft} onChange={(event) => editor.updateDraft(event.target.value)}
            placeholder={t("systemPromptInjection.promptPlaceholder")} />
        </label>
        {editor.error && <p className={styles.error}>{editor.error}</p>}
      </div>
    </Modal>
  );
}

function PromptTable({ editor, loading, prompts, t }: {
  editor: PromptEditor;
  loading: boolean;
  prompts: SystemPromptRule[];
  t: Translate;
}) {
  const columns: TableColumnsType<SystemPromptRule> = [
    {
      title: t("systemPromptInjection.promptName"),
      dataIndex: "name",
      key: "name",
      width: 180,
      render: (name: string | undefined) => name || t("systemPromptInjection.unnamedPrompt"),
    },
    {
      title: t("systemPromptInjection.promptContent"),
      dataIndex: "text",
      key: "text",
      render: (text: string) => <span className={styles.promptPreview} title={text}>{promptPreview(text)}</span>,
    },
    {
      title: t("systemPromptInjection.promptActions"),
      key: "actions",
      width: 160,
      align: "center",
      render: (_value, prompt, index) => (
        <div className={styles.promptActions}>
          <Switch aria-label={t("systemPromptInjection.togglePrompt")} checked={prompt.enabled}
            disabled={loading} onChange={(enabled) => void editor.togglePrompt(index, enabled)} size="small" />
          <Button aria-label={t("systemPromptInjection.editPrompt")} disabled={loading}
            icon={<Pencil size={15} />} onClick={() => editor.beginEdit(index)} type="text" />
          <Button aria-label={t("systemPromptInjection.deletePrompt")} danger disabled={loading}
            icon={<Trash2 size={15} />} onClick={() => void editor.deletePrompt(index)} type="text" />
        </div>
      ),
    },
  ];
  return <Table<SystemPromptRule> className={styles.promptTable} rowKey={(_, index) => String(index)}
    columns={columns} dataSource={prompts} pagination={false} size="small"
    locale={{ emptyText: t("systemPromptInjection.emptyPrompts") }} />;
}

function PromptList({ enabled, loading, onChange, onEnabledChange, prompts, t }: {
  enabled: boolean;
  loading: boolean;
  onChange: (prompts: SystemPromptRule[]) => Promise<boolean>;
  onEnabledChange: (enabled: boolean) => void;
  prompts: SystemPromptRule[];
  t: Translate;
}) {
  const editor = usePromptEditor(prompts, onChange, t);
  const [topbarHost, setTopbarHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTopbarHost(document.getElementById(TOPBAR_ACTIONS_ID));
    return () => setTopbarHost(null);
  }, []);
  return <section className={styles.promptsCard}>
    <div className={styles.sectionHeading}><div>
      <h2>{t("systemPromptInjection.promptsTitle")}</h2>
      <p>{t("systemPromptInjection.promptsDescription")}</p>
    </div><span className={styles.promptCount}>
      {t("systemPromptInjection.promptCount", { count: prompts.length })}
    </span></div>
    {prompts.length === 0 ? <div className={styles.emptyState}>
      <Sparkles size={24} /><strong>{t("systemPromptInjection.emptyPrompts")}</strong>
      <span>{t("systemPromptInjection.emptyPromptsHint")}</span>
    </div> : <PromptTable editor={editor} loading={loading} prompts={prompts} t={t} />}
    <PromptEditorModal editor={editor} loading={loading} t={t} />
    {topbarHost && createPortal(
      <div className={styles.topbarControls}>
        <Switch aria-label={t("systemPromptInjection.toggleTitle")} checked={enabled}
          loading={loading} onChange={onEnabledChange} />
        <Button disabled={loading} icon={<Plus size={16} />} onClick={editor.openAdd} type="primary">
          {t("systemPromptInjection.addPrompt")}
        </Button>
      </div>,
      topbarHost,
    )}
  </section>;
}

export function SystemPromptInjectionPage({
  enabled, loading, onEnabledChange, onPromptsChange, prompts, t,
}: SystemPromptInjectionPageProps) {
  return <div className={styles.page}>
    <PromptList enabled={enabled} loading={loading} onChange={onPromptsChange} prompts={prompts}
      onEnabledChange={onEnabledChange} t={t} />
    <p className={styles.notice}>{t("systemPromptInjection.notice")}</p>
  </div>;
}

import { Button, Input, Switch } from "antd";
import { Check, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import type { Translate } from "../../i18n";
import type { SystemPromptRule } from "../../types";
import styles from "./index.module.less";
import { type PromptEditor, usePromptEditor } from "./usePromptEditor";

const MAX_PROMPT_LENGTH = 500;

interface SystemPromptInjectionPageProps {
  enabled: boolean;
  loading: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onPromptsChange: (prompts: SystemPromptRule[]) => Promise<boolean>;
  prompts: SystemPromptRule[];
  proxyRunning: boolean;
  t: Translate;
}

function PromptRows({ editor, loading, prompts, t }: {
  editor: PromptEditor;
  loading: boolean;
  prompts: SystemPromptRule[];
  t: Translate;
}) {
  return <div className={styles.promptList}>
    {prompts.map((prompt, index) => <div className={styles.promptRow} key={`${prompt.text}-${index}`}>
      {editor.editingIndex === index ? (
        <Input autoFocus maxLength={MAX_PROMPT_LENGTH}
          onChange={(event) => editor.updateEditingValue(event.target.value)}
          onPressEnter={() => void editor.saveEdit()} value={editor.editingValue} />
          ) : <span>{prompt.text}</span>}
          <div className={styles.promptActions}>
            <Switch aria-label={t("systemPromptInjection.togglePrompt")} checked={prompt.enabled}
              disabled={loading} onChange={(enabled) => void editor.togglePrompt(index, enabled)} size="small" />
        {editor.editingIndex === index ? <>
          <Button aria-label={t("systemPromptInjection.savePrompt")} disabled={loading}
            icon={<Check size={15} />} onClick={() => void editor.saveEdit()} type="text" />
          <Button aria-label={t("systemPromptInjection.cancelEdit")} icon={<X size={15} />}
            onClick={editor.cancelEdit} type="text" />
        </> : <Button aria-label={t("systemPromptInjection.editPrompt")} disabled={loading}
          icon={<Pencil size={15} />} onClick={() => editor.beginEdit(index)} type="text" />}
        <Button aria-label={t("systemPromptInjection.deletePrompt")} danger disabled={loading}
          icon={<Trash2 size={15} />} onClick={() => void editor.deletePrompt(index)} type="text" />
      </div>
    </div>)}
  </div>;
}

function PromptList({ loading, onChange, prompts, t }: {
  loading: boolean;
  onChange: (prompts: SystemPromptRule[]) => Promise<boolean>;
  prompts: SystemPromptRule[];
  t: Translate;
}) {
  const editor = usePromptEditor(prompts, onChange, t);
  return <section className={styles.promptsCard}>
    <div className={styles.sectionHeading}><div>
      <h2>{t("systemPromptInjection.promptsTitle")}</h2>
      <p>{t("systemPromptInjection.promptsDescription")}</p>
    </div><span className={styles.promptCount}>
      {t("systemPromptInjection.promptCount", { count: prompts.length })}
    </span></div>
    <div className={styles.addRow}>
      <Input maxLength={MAX_PROMPT_LENGTH} onChange={(event) => editor.updateDraft(event.target.value)}
        onPressEnter={() => void editor.addPrompt()} placeholder={t("systemPromptInjection.promptPlaceholder")}
        value={editor.draft} />
      <Button disabled={loading} icon={<Plus size={16} />} onClick={() => void editor.addPrompt()} type="primary">
        {t("systemPromptInjection.addPrompt")}
      </Button>
    </div>
    {editor.error && <p className={styles.error}>{editor.error}</p>}
    {prompts.length === 0 ? <div className={styles.emptyState}>
      <Sparkles size={24} /><strong>{t("systemPromptInjection.emptyPrompts")}</strong>
      <span>{t("systemPromptInjection.emptyPromptsHint")}</span>
    </div> : <PromptRows editor={editor} loading={loading} prompts={prompts} t={t} />}
  </section>;
}

export function SystemPromptInjectionPage({
  enabled, loading, onEnabledChange, onPromptsChange, prompts, proxyRunning, t,
}: SystemPromptInjectionPageProps) {
  return <div className={styles.page}>
    <section className={styles.controlCard}>
      <div className={styles.controlCopy}>
        <span className={`${styles.status}${proxyRunning ? ` ${styles.running}` : ""}`}>
          {t(proxyRunning ? "systemPromptInjection.proxyRunning" : "systemPromptInjection.proxyStopped")}
        </span>
        <h2>{t("systemPromptInjection.toggleTitle")}</h2>
        <p>{t("systemPromptInjection.description")}</p>
      </div>
      <Switch aria-label={t("systemPromptInjection.toggleTitle")} checked={enabled}
        loading={loading} onChange={onEnabledChange} />
    </section>
    <PromptList loading={loading} onChange={onPromptsChange} prompts={prompts} t={t} />
    <p className={styles.notice}>{t("systemPromptInjection.notice")}</p>
  </div>;
}

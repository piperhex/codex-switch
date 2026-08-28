import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { Button, Input, Modal, Switch, Table, type TableColumnsType } from "antd";
import { Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { Translate } from "../../i18n";
import type { SystemPromptRule } from "../../types";
import styles from "./index.module.less";
import { type RuleEditor, useRuleEditor } from "./useRuleEditor";

const MAX_RULE_LENGTH = 500;
const RULE_PREVIEW_CHAR_LIMIT = 200;
const TOPBAR_ACTIONS_ID = "system-prompt-filter-topbar-actions";

interface SystemPromptFilterPageProps {
  enabled: boolean;
  loading: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onRulesChange: (rules: SystemPromptRule[]) => Promise<boolean>;
  rules: SystemPromptRule[];
  t: Translate;
}

interface RuleListProps {
  enabled: boolean;
  loading: boolean;
  onChange: (rules: SystemPromptRule[]) => Promise<boolean>;
  onEnabledChange: (enabled: boolean) => void;
  rules: SystemPromptRule[];
  t: Translate;
}

interface RuleEditorModalProps {
  editor: RuleEditor;
  loading: boolean;
  t: Translate;
}

function rulePreview(value: string) {
  const characters = Array.from(value);
  return characters.length > RULE_PREVIEW_CHAR_LIMIT
    ? `${characters.slice(0, RULE_PREVIEW_CHAR_LIMIT).join("")}…`
    : value;
}

function RuleEditorModal({ editor, loading, t }: RuleEditorModalProps) {
  const isEditing = editor.editingIndex !== null;
  return (
    <Modal
      className={styles.editorModal}
      open={editor.modalOpen}
      width="80vw"
      title={t(isEditing ? "systemPromptFilter.editRule" : "systemPromptFilter.addRule")}
      okText={t("systemPromptFilter.saveRule")}
      cancelText={t("systemPromptFilter.cancelEdit")}
      confirmLoading={loading}
      onCancel={editor.closeModal}
      onOk={() => void editor.saveRule()}
    >
      <div className={styles.editorForm}>
        <label>
          <span>{t("systemPromptFilter.ruleName")}</span>
          <Input autoFocus value={editor.draftName}
            onChange={(event) => editor.updateDraftName(event.target.value)}
            placeholder={t("systemPromptFilter.ruleNamePlaceholder")} />
        </label>
        <label>
          <span>{t("systemPromptFilter.ruleContent")}</span>
          <Input.TextArea className={styles.ruleEditorTextArea} rows={8} maxLength={MAX_RULE_LENGTH}
            value={editor.draft} onChange={(event) => editor.updateDraft(event.target.value)}
            placeholder={t("systemPromptFilter.rulePlaceholder")} />
        </label>
        {editor.error && <p className={styles.error}>{editor.error}</p>}
      </div>
    </Modal>
  );
}

function RuleTable({ editor, loading, rules, t }: {
  editor: RuleEditor;
  loading: boolean;
  rules: SystemPromptRule[];
  t: Translate;
}) {
  const columns: TableColumnsType<SystemPromptRule> = [
    {
      title: t("systemPromptFilter.ruleName"),
      dataIndex: "name",
      key: "name",
      width: 180,
      render: (name: string | undefined) => name || t("systemPromptFilter.unnamedRule"),
    },
    {
      title: t("systemPromptFilter.ruleContent"),
      dataIndex: "text",
      key: "text",
      render: (text: string) => <span className={styles.rulePreview} title={text}>{rulePreview(text)}</span>,
    },
    {
      title: t("systemPromptFilter.ruleActions"),
      key: "actions",
      width: 160,
      align: "center",
      render: (_value, rule, index) => (
        <div className={styles.ruleActions}>
          <Switch aria-label={t("systemPromptFilter.toggleRule")} checked={rule.enabled}
            disabled={loading} onChange={(enabled) => void editor.toggleRule(index, enabled)} size="small" />
          <Button aria-label={t("systemPromptFilter.editRule")} disabled={loading}
            icon={<Pencil size={15} />} onClick={() => editor.beginEdit(index)} type="text" />
          <Button aria-label={t("systemPromptFilter.deleteRule")} danger disabled={loading}
            icon={<Trash2 size={15} />} onClick={() => void editor.deleteRule(index)} type="text" />
        </div>
      ),
    },
  ];
  return <Table<SystemPromptRule> className={styles.ruleTable} rowKey={(_, index) => String(index)}
    columns={columns} dataSource={rules} pagination={false} size="small"
    locale={{ emptyText: t("systemPromptFilter.emptyRules") }} />;
}

function RuleList({ enabled, loading, onChange, onEnabledChange, rules, t }: RuleListProps) {
  const editor = useRuleEditor(rules, onChange, t);
  const [topbarHost, setTopbarHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTopbarHost(document.getElementById(TOPBAR_ACTIONS_ID));
    return () => setTopbarHost(null);
  }, []);
  return (
    <section className={styles.rulesCard}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>{t("systemPromptFilter.rulesTitle")}</h2>
          <p>{t("systemPromptFilter.rulesDescription")}</p>
        </div>
        <span className={styles.ruleCount}>{t("systemPromptFilter.ruleCount", { count: rules.length })}</span>
      </div>
      {rules.length === 0 ? (
        <div className={styles.emptyState}>
          <ShieldCheck size={24} />
          <strong>{t("systemPromptFilter.emptyRules")}</strong>
          <span>{t("systemPromptFilter.emptyRulesHint")}</span>
        </div>
      ) : <RuleTable editor={editor} loading={loading} rules={rules} t={t} />}
      <RuleEditorModal editor={editor} loading={loading} t={t} />
      {topbarHost && createPortal(
        <div className={styles.topbarControls}>
          <Switch aria-label={t("systemPromptFilter.toggleTitle")} checked={enabled}
            loading={loading} onChange={onEnabledChange} />
          <Button disabled={loading} icon={<Plus size={16} />} onClick={editor.openAdd} type="primary">
            {t("systemPromptFilter.addRule")}
          </Button>
        </div>,
        topbarHost,
      )}
    </section>
  );
}

export function SystemPromptFilterPage(props: SystemPromptFilterPageProps) {
  const { enabled, loading, onEnabledChange, onRulesChange, rules, t } = props;
  return (
    <div className={styles.page}>
      <RuleList enabled={enabled} loading={loading} onChange={onRulesChange} onEnabledChange={onEnabledChange}
        rules={rules} t={t} />
      <p className={styles.notice}>{t("systemPromptFilter.notice")}</p>
    </div>
  );
}

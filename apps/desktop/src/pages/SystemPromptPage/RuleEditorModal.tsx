import { Input, Modal, Radio } from "antd";
import type { Translate } from "../../i18n";
import styles from "./index.module.less";
import type { RuleEditor } from "./useRuleEditor";
import { MAX_FILTER_RULE_LENGTH, type SystemPromptRuleKind } from "./types";

interface RuleTypeSelectorProps {
  disabled: boolean;
  onChange: (kind: SystemPromptRuleKind) => void;
  t: Translate;
  value: SystemPromptRuleKind;
}

interface RuleEditorModalProps {
  editor: RuleEditor;
  loading: boolean;
  t: Translate;
}

function RuleTypeSelector(props: RuleTypeSelectorProps) {
  const { disabled, onChange, t, value } = props;
  return (
    <Radio.Group
      aria-label={t("systemPrompts.ruleType")}
      buttonStyle="solid"
      className={styles.typeSelector}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as SystemPromptRuleKind)}
      optionType="button"
      options={[
        { label: t("systemPrompts.injection"), value: "injection" },
        { label: t("systemPrompts.filter"), value: "filter" },
      ]}
      value={value}
    />
  );
}

function RuleEditorForm(props: RuleEditorModalProps) {
  const { editor, loading, t } = props;
  const isEditing = editor.editingIndex !== null;
  const placeholderKey = editor.draftKind === "filter"
    ? "systemPrompts.filterPlaceholder"
    : "systemPrompts.injectionPlaceholder";
  return (
    <div className={styles.editorForm}>
      <label>
        <span>{t("systemPrompts.ruleName")}</span>
        <Input autoFocus value={editor.draftName}
          onChange={(event) => editor.updateDraftName(event.target.value)}
          placeholder={t("systemPrompts.ruleNamePlaceholder")} />
      </label>
      <div className={styles.editorField}>
        <span>{t("systemPrompts.ruleType")}</span>
        <RuleTypeSelector disabled={loading || isEditing} onChange={editor.updateDraftKind}
          t={t} value={editor.draftKind} />
      </div>
      <label className={styles.contentField}>
        <span>{t("systemPrompts.ruleContent")}</span>
        <Input.TextArea className={styles.ruleEditorTextArea} rows={10}
          showCount={editor.draftKind === "filter" ? {
            formatter: ({ value }) => `${Array.from(value).length}/${MAX_FILTER_RULE_LENGTH}`,
          } : false}
          value={editor.draft} onChange={(event) => editor.updateDraft(event.target.value)}
          placeholder={t(placeholderKey)} />
      </label>
      {editor.error && <p className={styles.error}>{editor.error}</p>}
    </div>
  );
}

export function RuleEditorModal(props: RuleEditorModalProps) {
  const { editor, loading, t } = props;
  const isEditing = editor.editingIndex !== null;
  return (
    <Modal
      className={styles.editorModal}
      open={editor.modalOpen}
      width="80vw"
      title={t(isEditing ? "systemPrompts.editRule" : "systemPrompts.addRule")}
      okText={t("systemPrompts.saveRule")}
      cancelText={t("systemPrompts.cancelEdit")}
      confirmLoading={loading}
      onCancel={editor.closeModal}
      onOk={() => void editor.saveRule()}
    >
      <RuleEditorForm editor={editor} loading={loading} t={t} />
    </Modal>
  );
}

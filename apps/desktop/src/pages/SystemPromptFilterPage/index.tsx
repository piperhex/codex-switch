import { Button, Input, Switch } from "antd";
import { Check, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import type { Translate } from "../../i18n";
import styles from "./index.module.less";
import { type RuleEditor, useRuleEditor } from "./useRuleEditor";

const MAX_RULE_LENGTH = 500;

interface SystemPromptFilterPageProps {
  enabled: boolean;
  loading: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onRulesChange: (rules: string[]) => Promise<boolean>;
  proxyRunning: boolean;
  rules: string[];
  t: Translate;
}

interface RuleListProps {
  loading: boolean;
  onChange: (rules: string[]) => Promise<boolean>;
  rules: string[];
  t: Translate;
}

interface RuleRowsProps {
  editor: RuleEditor;
  loading: boolean;
  rules: string[];
  t: Translate;
}

function RuleRows({ editor, loading, rules, t }: RuleRowsProps) {
  return (
    <div className={styles.ruleList}>
      {rules.map((rule, index) => (
        <div className={styles.ruleRow} key={`${rule}-${index}`}>
          {editor.editingIndex === index ? (
            <Input autoFocus maxLength={MAX_RULE_LENGTH}
              onChange={(event) => editor.updateEditingValue(event.target.value)}
              onPressEnter={() => void editor.saveEdit()} value={editor.editingValue} />
          ) : <span>{rule}</span>}
          <div className={styles.ruleActions}>
            {editor.editingIndex === index ? (
              <>
                <Button aria-label={t("systemPromptFilter.saveRule")} disabled={loading}
                  icon={<Check size={15} />} onClick={() => void editor.saveEdit()} type="text" />
                <Button aria-label={t("systemPromptFilter.cancelEdit")} icon={<X size={15} />}
                  onClick={editor.cancelEdit} type="text" />
              </>
            ) : (
              <Button aria-label={t("systemPromptFilter.editRule")} disabled={loading}
                icon={<Pencil size={15} />} onClick={() => editor.beginEdit(index)} type="text" />
            )}
            <Button aria-label={t("systemPromptFilter.deleteRule")} danger disabled={loading}
              icon={<Trash2 size={15} />} onClick={() => void editor.deleteRule(index)} type="text" />
          </div>
        </div>
      ))}
    </div>
  );
}

function RuleList({ loading, onChange, rules, t }: RuleListProps) {
  const editor = useRuleEditor(rules, onChange, t);
  return (
    <section className={styles.rulesCard}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>{t("systemPromptFilter.rulesTitle")}</h2>
          <p>{t("systemPromptFilter.rulesDescription")}</p>
        </div>
        <span className={styles.ruleCount}>{t("systemPromptFilter.ruleCount", { count: rules.length })}</span>
      </div>
      <div className={styles.addRow}>
        <Input maxLength={MAX_RULE_LENGTH} onChange={(event) => editor.updateDraft(event.target.value)}
          onPressEnter={() => void editor.addRule()} placeholder={t("systemPromptFilter.rulePlaceholder")}
          value={editor.draft} />
        <Button disabled={loading} icon={<Plus size={16} />}
          onClick={() => void editor.addRule()} type="primary">
          {t("systemPromptFilter.addRule")}
        </Button>
      </div>
      {editor.error && <p className={styles.error}>{editor.error}</p>}
      {rules.length === 0 ? (
        <div className={styles.emptyState}>
          <ShieldCheck size={24} />
          <strong>{t("systemPromptFilter.emptyRules")}</strong>
          <span>{t("systemPromptFilter.emptyRulesHint")}</span>
        </div>
      ) : <RuleRows editor={editor} loading={loading} rules={rules} t={t} />}
    </section>
  );
}

export function SystemPromptFilterPage(props: SystemPromptFilterPageProps) {
  const { enabled, loading, onEnabledChange, onRulesChange, proxyRunning, rules, t } = props;
  return (
    <div className={styles.page}>
      <section className={styles.controlCard}>
        <div className={styles.controlCopy}>
          <span className={`${styles.status}${proxyRunning ? ` ${styles.running}` : ""}`}>
            {t(proxyRunning ? "systemPromptFilter.proxyRunning" : "systemPromptFilter.proxyStopped")}
          </span>
          <h2>{t("systemPromptFilter.toggleTitle")}</h2>
          <p>{t("systemPromptFilter.description")}</p>
        </div>
        <Switch aria-label={t("systemPromptFilter.toggleTitle")} checked={enabled}
          loading={loading} onChange={onEnabledChange} />
      </section>
      <RuleList loading={loading} onChange={onRulesChange} rules={rules} t={t} />
      <p className={styles.notice}>{t("systemPromptFilter.notice")}</p>
    </div>
  );
}

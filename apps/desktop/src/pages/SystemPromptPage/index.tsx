import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import type { SystemPromptRule } from "../../types";
import { RuleEditorModal } from "./RuleEditorModal";
import { RuleTable } from "./RuleTable";
import { TopbarControls } from "./TopbarControls";
import styles from "./index.module.less";
import type {
  SystemPromptListItem,
  SystemPromptPageProps,
  SystemPromptRuleKind,
} from "./types";
import { type RuleEditor, useRuleEditor } from "./useRuleEditor";

const TOPBAR_ACTIONS_ID = "system-prompt-topbar-actions";

function typedRules(kind: SystemPromptRuleKind, rules: SystemPromptRule[]): SystemPromptListItem[] {
  return rules.map((rule, sourceIndex) => ({
    ...rule,
    key: `${kind}-${sourceIndex}`,
    kind,
    sourceIndex,
  }));
}

function RulesCard({ editor, items, loading, t }: Pick<SystemPromptPageProps, "loading" | "t"> & {
  editor: RuleEditor;
  items: SystemPromptListItem[];
}) {
  return (
    <section className={styles.rulesCard}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>{t("systemPrompts.rulesTitle")}</h2>
          <p>{t("systemPrompts.rulesDescription")}</p>
        </div>
        <span className={styles.ruleCount}>{t("systemPrompts.ruleCount", { count: items.length })}</span>
      </div>
      {items.length === 0 ? (
        <div className={styles.emptyState}>
          <Sparkles size={24} />
          <strong>{t("systemPrompts.emptyRules")}</strong>
          <span>{t("systemPrompts.emptyRulesHint")}</span>
        </div>
      ) : <RuleTable editor={editor} items={items} loading={loading} t={t} />}
    </section>
  );
}

export function SystemPromptPage(props: SystemPromptPageProps) {
  const {
    filterEnabled, filterRules, injectionEnabled, injectionPrompts, loading,
    onFilterEnabledChange, onFilterRulesChange,
    onInjectionEnabledChange, onInjectionPromptsChange, t,
  } = props;
  const editor = useRuleEditor({
    filterRules,
    injectionPrompts,
    onFilterRulesChange,
    onInjectionPromptsChange,
    t,
  });
  const items = useMemo(() => [
    ...typedRules("filter", filterRules),
    ...typedRules("injection", injectionPrompts),
  ], [filterRules, injectionPrompts]);
  const [topbarHost, setTopbarHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTopbarHost(document.getElementById(TOPBAR_ACTIONS_ID));
    return () => setTopbarHost(null);
  }, []);

  return (
    <div className={styles.page}>
      <RulesCard editor={editor} items={items} loading={loading} t={t} />
      <RuleEditorModal editor={editor} loading={loading} t={t} />
      {topbarHost && createPortal(
        <TopbarControls
          filterEnabled={filterEnabled}
          injectionEnabled={injectionEnabled}
          loading={loading}
          onAdd={editor.openAdd}
          onFilterEnabledChange={onFilterEnabledChange}
          onInjectionEnabledChange={onInjectionEnabledChange}
          t={t}
        />,
        topbarHost,
      )}
      <p className={styles.notice}>{t("systemPrompts.notice")}</p>
    </div>
  );
}

export type { SystemPromptPageProps } from "./types";

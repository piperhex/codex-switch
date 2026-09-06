import type { Translate } from "../../i18n";
import type { SystemPromptRule } from "../../types";

export const MAX_FILTER_RULE_LENGTH = 500;

export type SystemPromptRuleKind = "filter" | "injection";

export interface SystemPromptListItem extends SystemPromptRule {
  key: string;
  kind: SystemPromptRuleKind;
  sourceIndex: number;
}

export interface SystemPromptPageProps {
  filterEnabled: boolean;
  filterRules: SystemPromptRule[];
  injectionEnabled: boolean;
  injectionPrompts: SystemPromptRule[];
  loading: boolean;
  onFilterEnabledChange: (enabled: boolean) => void;
  onFilterRulesChange: (rules: SystemPromptRule[]) => Promise<boolean>;
  onInjectionEnabledChange: (enabled: boolean) => void;
  onInjectionPromptsChange: (prompts: SystemPromptRule[]) => Promise<boolean>;
  t: Translate;
}

export interface RuleEditorOptions {
  filterRules: SystemPromptRule[];
  injectionPrompts: SystemPromptRule[];
  onFilterRulesChange: (rules: SystemPromptRule[]) => Promise<boolean>;
  onInjectionPromptsChange: (prompts: SystemPromptRule[]) => Promise<boolean>;
  t: Translate;
}

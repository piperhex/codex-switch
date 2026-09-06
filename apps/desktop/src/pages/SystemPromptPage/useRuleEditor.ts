import { useState } from "react";
import type { SystemPromptRule } from "../../types";
import {
  MAX_FILTER_RULE_LENGTH,
  type RuleEditorOptions,
  type SystemPromptListItem,
  type SystemPromptRuleKind,
} from "./types";

function rulesForKind(options: RuleEditorOptions, kind: SystemPromptRuleKind) {
  return kind === "filter" ? options.filterRules : options.injectionPrompts;
}

function persistRules(
  options: RuleEditorOptions,
  kind: SystemPromptRuleKind,
  rules: SystemPromptRule[],
) {
  return kind === "filter"
    ? options.onFilterRulesChange(rules)
    : options.onInjectionPromptsChange(rules);
}

function normalizedRule(value: string) {
  return value.trim().toLocaleLowerCase();
}

interface RuleValidationOptions {
  ignoredIndex?: number;
  kind: SystemPromptRuleKind;
  options: RuleEditorOptions;
  rules: SystemPromptRule[];
}

function validationError(value: string, validation: RuleValidationOptions) {
  const trimmed = value.trim();
  if (!trimmed) return validation.options.t("systemPrompts.ruleRequired");
  if (validation.kind === "filter" && Array.from(trimmed).length > MAX_FILTER_RULE_LENGTH) {
    return validation.options.t("systemPrompts.filterRuleTooLong", { count: MAX_FILTER_RULE_LENGTH });
  }
  const normalized = normalizedRule(value);
  const duplicate = validation.rules.some((rule, index) => (
    index !== validation.ignoredIndex && normalizedRule(rule.text) === normalized
  ));
  return duplicate ? validation.options.t("systemPrompts.ruleDuplicate") : "";
}

function updatedRules(
  rules: SystemPromptRule[],
  editingIndex: number | null,
  nextRule: SystemPromptRule,
) {
  if (editingIndex === null) return [...rules, nextRule];
  return rules.map((rule, index) => (index === editingIndex ? nextRule : rule));
}

function useRuleDraft() {
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftKind, setDraftKind] = useState<SystemPromptRuleKind>("injection");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [error, setError] = useState("");

  const closeModal = () => {
    setModalOpen(false);
    setEditingIndex(null);
    setError("");
  };
  const openAdd = () => {
    setDraft("");
    setDraftName("");
    setDraftKind("injection");
    setEditingIndex(null);
    setError("");
    setModalOpen(true);
  };
  const beginEdit = (item: SystemPromptListItem) => {
    setDraft(item.text);
    setDraftName(item.name ?? "");
    setDraftKind(item.kind);
    setEditingIndex(item.sourceIndex);
    setError("");
    setModalOpen(true);
  };
  const updateDraftKind = (kind: SystemPromptRuleKind) => {
    setDraftKind(kind);
    setError("");
  };

  return {
    beginEdit, closeModal, draft, draftKind, draftName, editingIndex, error, modalOpen, openAdd,
    setError, updateDraft: (value: string) => { setDraft(value); setError(""); },
    updateDraftKind, updateDraftName: (value: string) => { setDraftName(value); setError(""); },
  };
}

export function useRuleEditor(options: RuleEditorOptions) {
  const draftState = useRuleDraft();
  const saveRule = async () => {
    const { draft, draftKind, draftName, editingIndex } = draftState;
    if (!draftName.trim()) return draftState.setError(options.t("systemPrompts.ruleNameRequired"));
    const rules = rulesForKind(options, draftKind);
    const problem = validationError(draft, {
      ignoredIndex: editingIndex ?? undefined,
      kind: draftKind,
      options,
      rules,
    });
    if (problem) return draftState.setError(problem);
    const nextRule = {
      enabled: editingIndex === null ? true : rules[editingIndex].enabled,
      name: draftName.trim(),
      text: draft.trim(),
    };
    if (await persistRules(options, draftKind, updatedRules(rules, editingIndex, nextRule))) {
      draftState.closeModal();
    }
  };
  const deleteRule = async (item: SystemPromptListItem) => {
    const rules = rulesForKind(options, item.kind);
    const nextRules = rules.filter((_, index) => index !== item.sourceIndex);
    if (!(await persistRules(options, item.kind, nextRules))) return;
    if (draftState.editingIndex === item.sourceIndex && draftState.draftKind === item.kind) {
      draftState.closeModal();
    }
  };
  const toggleRule = async (item: SystemPromptListItem, enabled: boolean) => {
    const rules = rulesForKind(options, item.kind);
    const nextRules = rules.map((rule, index) => (
      index === item.sourceIndex ? { ...rule, enabled } : rule
    ));
    await persistRules(options, item.kind, nextRules);
  };

  return {
    ...draftState,
    deleteRule,
    saveRule,
    toggleRule,
  };
}

export type RuleEditor = ReturnType<typeof useRuleEditor>;

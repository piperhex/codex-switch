import { useState } from "react";
import type { Translate } from "../../i18n";
import type { SystemPromptRule } from "../../types";

function normalizedRule(value: string) {
  return value.trim().toLocaleLowerCase();
}

function ruleValidationError(
  value: string,
  rules: SystemPromptRule[],
  t: Translate,
  ignoredIndex?: number,
) {
  if (!value.trim()) return t("systemPromptFilter.ruleRequired");
  const normalized = normalizedRule(value);
  const duplicate = rules.some((rule, index) => (
    index !== ignoredIndex && normalizedRule(rule.text) === normalized
  ));
  return duplicate ? t("systemPromptFilter.ruleDuplicate") : "";
}

export function useRuleEditor(
  rules: SystemPromptRule[],
  onChange: (rules: SystemPromptRule[]) => Promise<boolean>,
  t: Translate,
) {
  const [draft, setDraft] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [error, setError] = useState("");

  const updateDraft = (value: string) => { setDraft(value); setError(""); };
  const updateEditingValue = (value: string) => { setEditingValue(value); setError(""); };
  const cancelEdit = () => { setEditingIndex(null); setError(""); };
  const beginEdit = (index: number) => {
    setEditingIndex(index);
    setEditingValue(rules[index].text);
    setError("");
  };
  const addRule = async () => {
    const validationError = ruleValidationError(draft, rules, t);
    if (validationError) return setError(validationError);
    if (await onChange([...rules, { text: draft.trim(), enabled: true }])) updateDraft("");
  };
  const saveEdit = async () => {
    if (editingIndex === null) return;
    const validationError = ruleValidationError(editingValue, rules, t, editingIndex);
    if (validationError) return setError(validationError);
    const nextRules = rules.map((rule, index) => (
      index === editingIndex ? { ...rule, text: editingValue.trim() } : rule
    ));
    if (await onChange(nextRules)) {
      setEditingValue("");
      cancelEdit();
    }
  };
  const deleteRule = async (index: number) => {
    if (!(await onChange(rules.filter((_, ruleIndex) => ruleIndex !== index)))) return;
    if (editingIndex === index) setEditingIndex(null);
    setError("");
  };
  const toggleRule = async (index: number, enabled: boolean) => {
    await onChange(rules.map((rule, ruleIndex) => (
      ruleIndex === index ? { ...rule, enabled } : rule
    )));
  };

  return {
    addRule,
    beginEdit,
    cancelEdit,
    deleteRule,
    draft,
    editingIndex,
    editingValue,
    error,
    saveEdit,
    toggleRule,
    updateDraft,
    updateEditingValue,
  };
}

export type RuleEditor = ReturnType<typeof useRuleEditor>;

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
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftName, setDraftName] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [error, setError] = useState("");

  const updateDraft = (value: string) => { setDraft(value); setError(""); };
  const updateDraftName = (value: string) => { setDraftName(value); setError(""); };
  const closeModal = () => {
    setModalOpen(false);
    setEditingIndex(null);
    setError("");
  };
  const openAdd = () => {
    setDraftName("");
    setDraft("");
    setEditingIndex(null);
    setError("");
    setModalOpen(true);
  };
  const beginEdit = (index: number) => {
    setEditingIndex(index);
    setDraftName(rules[index].name ?? "");
    setDraft(rules[index].text);
    setError("");
    setModalOpen(true);
  };
  const saveRule = async () => {
    if (!draftName.trim()) return setError(t("systemPromptFilter.ruleNameRequired"));
    const validationError = ruleValidationError(draft, rules, t, editingIndex ?? undefined);
    if (validationError) return setError(validationError);
    const nextRule = {
      name: draftName.trim(),
      text: draft.trim(),
      enabled: editingIndex === null ? true : rules[editingIndex].enabled,
    };
    const nextRules = editingIndex === null
      ? [...rules, nextRule]
      : rules.map((rule, index) => (index === editingIndex ? nextRule : rule));
    if (await onChange(nextRules)) {
      setDraft("");
      setDraftName("");
      closeModal();
    }
  };
  const deleteRule = async (index: number) => {
    if (!(await onChange(rules.filter((_, ruleIndex) => ruleIndex !== index)))) return;
    if (editingIndex === index) closeModal();
    setError("");
  };
  const toggleRule = async (index: number, enabled: boolean) => {
    await onChange(rules.map((rule, ruleIndex) => (
      ruleIndex === index ? { ...rule, enabled } : rule
    )));
  };

  return {
    beginEdit,
    closeModal,
    deleteRule,
    draft,
    draftName,
    editingIndex,
    error,
    modalOpen,
    openAdd,
    saveRule,
    toggleRule,
    updateDraft,
    updateDraftName,
  };
}

export type RuleEditor = ReturnType<typeof useRuleEditor>;

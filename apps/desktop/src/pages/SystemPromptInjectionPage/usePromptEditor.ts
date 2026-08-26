import { useState } from "react";
import type { Translate } from "../../i18n";
import type { SystemPromptRule } from "../../types";

function normalizedPrompt(value: string) { return value.trim().toLocaleLowerCase(); }

function promptValidationError(
  value: string,
  prompts: SystemPromptRule[],
  t: Translate,
  ignoredIndex?: number,
) {
  if (!value.trim()) return t("systemPromptInjection.promptRequired");
  const normalized = normalizedPrompt(value);
  const duplicate = prompts.some((prompt, index) => (
    index !== ignoredIndex && normalizedPrompt(prompt.text) === normalized
  ));
  return duplicate ? t("systemPromptInjection.promptDuplicate") : "";
}

export function usePromptEditor(
  prompts: SystemPromptRule[],
  onChange: (prompts: SystemPromptRule[]) => Promise<boolean>,
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
    setEditingValue(prompts[index].text);
    setError("");
  };
  const addPrompt = async () => {
    const validationError = promptValidationError(draft, prompts, t);
    if (validationError) return setError(validationError);
    if (await onChange([...prompts, { text: draft.trim(), enabled: true }])) updateDraft("");
  };
  const saveEdit = async () => {
    if (editingIndex === null) return;
    const validationError = promptValidationError(editingValue, prompts, t, editingIndex);
    if (validationError) return setError(validationError);
    const nextPrompts = prompts.map((prompt, index) => (
      index === editingIndex ? { ...prompt, text: editingValue.trim() } : prompt
    ));
    if (await onChange(nextPrompts)) {
      setEditingValue("");
      cancelEdit();
    }
  };
  const deletePrompt = async (index: number) => {
    if (!(await onChange(prompts.filter((_, promptIndex) => promptIndex !== index)))) return;
    if (editingIndex === index) setEditingIndex(null);
    setError("");
  };
  const togglePrompt = async (index: number, enabled: boolean) => {
    await onChange(prompts.map((prompt, promptIndex) => (
      promptIndex === index ? { ...prompt, enabled } : prompt
    )));
  };
  return {
    addPrompt, beginEdit, cancelEdit, deletePrompt, draft, editingIndex, editingValue,
    error, saveEdit, togglePrompt, updateDraft, updateEditingValue,
  };
}

export type PromptEditor = ReturnType<typeof usePromptEditor>;

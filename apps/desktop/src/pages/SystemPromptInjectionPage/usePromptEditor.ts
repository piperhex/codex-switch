import { useState } from "react";
import type { Translate } from "../../i18n";

function normalizedPrompt(value: string) { return value.trim().toLocaleLowerCase(); }

function promptValidationError(value: string, prompts: string[], t: Translate, ignoredIndex?: number) {
  if (!value.trim()) return t("systemPromptInjection.promptRequired");
  const normalized = normalizedPrompt(value);
  const duplicate = prompts.some((prompt, index) => (
    index !== ignoredIndex && normalizedPrompt(prompt) === normalized
  ));
  return duplicate ? t("systemPromptInjection.promptDuplicate") : "";
}

export function usePromptEditor(
  prompts: string[],
  onChange: (prompts: string[]) => Promise<boolean>,
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
    setEditingValue(prompts[index]);
    setError("");
  };
  const addPrompt = async () => {
    const validationError = promptValidationError(draft, prompts, t);
    if (validationError) return setError(validationError);
    if (await onChange([...prompts, draft.trim()])) updateDraft("");
  };
  const saveEdit = async () => {
    if (editingIndex === null) return;
    const validationError = promptValidationError(editingValue, prompts, t, editingIndex);
    if (validationError) return setError(validationError);
    const nextPrompts = prompts.map((prompt, index) => (
      index === editingIndex ? editingValue.trim() : prompt
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
  return {
    addPrompt, beginEdit, cancelEdit, deletePrompt, draft, editingIndex, editingValue,
    error, saveEdit, updateDraft, updateEditingValue,
  };
}

export type PromptEditor = ReturnType<typeof usePromptEditor>;

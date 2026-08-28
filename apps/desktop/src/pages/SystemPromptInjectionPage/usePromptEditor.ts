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
    setDraftName(prompts[index].name ?? "");
    setDraft(prompts[index].text);
    setError("");
    setModalOpen(true);
  };
  const savePrompt = async () => {
    if (!draftName.trim()) return setError(t("systemPromptInjection.promptNameRequired"));
    const validationError = promptValidationError(draft, prompts, t, editingIndex ?? undefined);
    if (validationError) return setError(validationError);
    const nextPrompt = {
      name: draftName.trim(),
      text: draft.trim(),
      enabled: editingIndex === null ? true : prompts[editingIndex].enabled,
    };
    const nextPrompts = editingIndex === null
      ? [...prompts, nextPrompt]
      : prompts.map((prompt, index) => (index === editingIndex ? nextPrompt : prompt));
    if (await onChange(nextPrompts)) {
      setDraft("");
      setDraftName("");
      closeModal();
    }
  };
  const deletePrompt = async (index: number) => {
    if (!(await onChange(prompts.filter((_, promptIndex) => promptIndex !== index)))) return;
    if (editingIndex === index) closeModal();
    setError("");
  };
  const togglePrompt = async (index: number, enabled: boolean) => {
    await onChange(prompts.map((prompt, promptIndex) => (
      promptIndex === index ? { ...prompt, enabled } : prompt
    )));
  };
  return {
    beginEdit, closeModal, deletePrompt, draft, draftName, editingIndex, error,
    modalOpen, openAdd, savePrompt, togglePrompt, updateDraft, updateDraftName,
  };
}

export type PromptEditor = ReturnType<typeof usePromptEditor>;

import type { Model, Settings } from "./types";

export type ModelSelection = Pick<Settings, "model" | "effort">;

/** Resolve defaults to explicit values so the picker and outgoing requests agree. */
export function resolveModelSelection(models: Model[], selection: ModelSelection): ModelSelection {
  const selected = models.find((entry) => entry.model === selection.model);
  const target = selected ?? models.find((entry) => entry.isDefault) ?? models[0];
  if (!target) return { model: "", effort: "" };
  const efforts = target.supportedReasoningEfforts.map((entry) => entry.reasoningEffort);
  const preferred = target.defaultReasoningEffort;
  const defaultEffort = preferred && (!efforts.length || efforts.includes(preferred))
    ? preferred : efforts.at(-1) ?? "none";
  const effort = selected && efforts.includes(selection.effort) ? selection.effort : defaultEffort;
  return { model: target.model, effort };
}

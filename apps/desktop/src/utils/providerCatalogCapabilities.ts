import type {
  ModelContextWindows,
  ModelReasoningEfforts,
  ReasoningEffort,
} from "../types";
import type { ProviderPresetId } from "./providerCatalog";

const ONE_MILLION = 1_000_000;
const KIMI_K3_CONTEXT_WINDOW = 1_048_576;
const MINIMAX_CONTEXT_WINDOW = 204_800;
const STANDARD_CODING_CONTEXT_WINDOW = 256_000;

export function catalogReasoningEfforts(
  presetId: ProviderPresetId,
  models: string[],
  existing: ModelReasoningEfforts,
): ModelReasoningEfforts {
  return Object.fromEntries(models.map((model) => [
    model,
    existing[model]?.length ? existing[model] : reasoningEfforts(presetId, model),
  ]));
}

export function catalogContextWindows(
  presetId: ProviderPresetId,
  models: string[],
  existing: ModelContextWindows,
): ModelContextWindows {
  return Object.fromEntries(models.flatMap((model) => {
    const contextWindow = existing[model] ?? knownContextWindow(presetId, model);
    return contextWindow ? [[model, contextWindow]] : [];
  }));
}

export function catalogImageInputModels(
  presetId: ProviderPresetId,
  models: string[],
  existing: string[],
): string[] {
  return models.filter((model) => (
    existing.includes(model) || knownImageInput(presetId, model)
  ));
}

function reasoningEfforts(presetId: ProviderPresetId, model: string): ReasoningEffort[] {
  const normalized = model.toLowerCase();
  if (presetId === "kimi") {
    return normalized.startsWith("kimi-k3") ? ["low", "high", "max"] : ["high"];
  }
  if (presetId === "gemini") return ["low", "medium", "high"];
  if (presetId === "miniMax") return ["high"];
  if (presetId === "openRouter") return ["low", "medium", "high"];
  if (presetId === "ollama" || presetId === "lmStudio") {
    return ["none", "low", "medium", "high"];
  }
  return ["none", "high"];
}

function knownContextWindow(presetId: ProviderPresetId, model: string): number | undefined {
  const normalized = model.toLowerCase();
  if (presetId === "kimi") {
    return normalized.startsWith("kimi-k3")
      ? KIMI_K3_CONTEXT_WINDOW
      : STANDARD_CODING_CONTEXT_WINDOW;
  }
  if (presetId === "gemini" || presetId === "volcengine") {
    return ONE_MILLION;
  }
  if (presetId === "miniMax" && normalized.startsWith("minimax-m")) {
    return MINIMAX_CONTEXT_WINDOW;
  }
  if (presetId === "bailian" && /^qwen3\.[67]-/.test(normalized)) return ONE_MILLION;
  if (presetId === "glm" && normalized === "glm-5.2") return ONE_MILLION;
  if (presetId === "mistral" && normalized.includes("devstral")) {
    return STANDARD_CODING_CONTEXT_WINDOW;
  }
  return undefined;
}

function knownImageInput(presetId: ProviderPresetId, model: string): boolean {
  const normalized = model.toLowerCase();
  if (presetId === "gemini") return normalized.startsWith("gemini-");
  if (presetId === "kimi") return normalized.startsWith("kimi-k3") || normalized === "kimi-k2.5";
  if (presetId === "bailian") {
    return normalized.startsWith("qwen3.7-") || normalized.startsWith("qwen3.6-");
  }
  return false;
}

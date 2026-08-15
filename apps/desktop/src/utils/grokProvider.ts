import type {
  ModelContextWindows,
  ModelReasoningEfforts,
  Provider,
  ProviderInput,
  ReasoningEffort,
} from "../types";

export const GROK_PROVIDER_NAME = "Grok";
export const GROK_BASE_URL = "https://api.x.ai/v1";
export const GROK_FALLBACK_MODELS = ["grok-build-0.1", "grok-4.6"];

const GROK_STANDARD_REASONING_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"];
const GROK_46_REASONING_EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];
const GROK_BUILD_CONTEXT_WINDOW = 256_000;
const GROK_46_CONTEXT_WINDOW = 500_000;
const GROK_LONG_CONTEXT_WINDOW = 1_000_000;

type GrokIdentity = Pick<ProviderInput, "kind" | "name" | "baseUrl" | "apiFormat">;

export function isGrokProvider(provider: Provider | GrokIdentity) {
  return provider.kind === "custom"
    && provider.name.trim() === GROK_PROVIDER_NAME
    && provider.apiFormat === "openaiResponses"
    && isOfficialGrokBaseUrl(provider.baseUrl);
}

export function grokReasoningEfforts(
  models: string[],
  existing: ModelReasoningEfforts,
): ModelReasoningEfforts {
  return Object.fromEntries(models.map((model) => [
    model,
    existing[model]?.length ? existing[model] : reasoningEffortsForModel(model),
  ]));
}

export function grokContextWindows(
  models: string[],
  existing: ModelContextWindows,
): ModelContextWindows {
  return Object.fromEntries(models.map((model) => [
    model,
    existing[model] ?? contextWindowForModel(model),
  ]));
}

export function grokImageInputModels(models: string[], existing: string[]) {
  return models.filter((model) => existing.includes(model) || supportsImageInput(model));
}

function reasoningEffortsForModel(model: string): ReasoningEffort[] {
  return model.toLowerCase().startsWith("grok-4.6")
    ? GROK_46_REASONING_EFFORTS
    : GROK_STANDARD_REASONING_EFFORTS;
}

function contextWindowForModel(model: string) {
  const normalized = model.toLowerCase();
  if (normalized.startsWith("grok-4.6") || normalized.startsWith("grok-4.5")) {
    return GROK_46_CONTEXT_WINDOW;
  }
  if (normalized.startsWith("grok-4.3") || normalized.startsWith("grok-4.20")) {
    return GROK_LONG_CONTEXT_WINDOW;
  }
  return GROK_BUILD_CONTEXT_WINDOW;
}

function supportsImageInput(model: string) {
  const normalized = model.toLowerCase();
  return normalized.startsWith("grok-4.6")
    || normalized.startsWith("grok-4.5")
    || normalized.startsWith("grok-build-")
    || normalized.startsWith("grok-code-fast");
}

function isOfficialGrokBaseUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname.toLowerCase() === "api.x.ai"
      && (!url.port || url.port === "443")
      && url.pathname.replace(/\/+$/, "") === "/v1"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

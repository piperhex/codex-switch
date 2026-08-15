import type {
  ModelContextWindows,
  ModelReasoningEfforts,
  Provider,
  ProviderInput,
  ReasoningEffort,
} from "../types";

export const CLAUDE_CODE_PROVIDER_NAME = "Claude Code";
export const CLAUDE_CODE_BASE_URL = "https://api.anthropic.com/v1";
export const CLAUDE_CODE_FALLBACK_MODELS = ["claude-sonnet-5", "claude-opus-5"];

const CLAUDE_DEFAULT_REASONING_EFFORTS: ReasoningEffort[] = ["high"];
const CLAUDE_5_CONTEXT_WINDOW = 1_000_000;
const CLAUDE_FALLBACK_CONTEXT_WINDOW = 200_000;

type ClaudeCodeIdentity = Pick<ProviderInput, "kind" | "name" | "baseUrl" | "apiFormat">;

export function isClaudeCodeProvider(provider: Provider | ClaudeCodeIdentity) {
  return provider.kind === "custom"
    && provider.name.trim() === CLAUDE_CODE_PROVIDER_NAME
    && provider.apiFormat === "openaiChat"
    && isOfficialClaudeBaseUrl(provider.baseUrl);
}

export function claudeCodeReasoningEfforts(models: string[]): ModelReasoningEfforts {
  return Object.fromEntries(models.map((model) => [model, CLAUDE_DEFAULT_REASONING_EFFORTS]));
}

export function claudeCodeContextWindows(
  models: string[],
  existing: ModelContextWindows,
): ModelContextWindows {
  return Object.fromEntries(models.map((model) => [
    model,
    existing[model] ?? contextWindowForModel(model),
  ]));
}

export function claudeCodeImageInputModels(models: string[]) {
  return models.filter((model) => model.toLowerCase().startsWith("claude-"));
}

function contextWindowForModel(model: string) {
  const normalized = model.toLowerCase();
  return /^claude-(?:fable|mythos|opus|sonnet)-5(?:-|$)/.test(normalized)
    ? CLAUDE_5_CONTEXT_WINDOW
    : CLAUDE_FALLBACK_CONTEXT_WINDOW;
}

function isOfficialClaudeBaseUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname.toLowerCase() === "api.anthropic.com"
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

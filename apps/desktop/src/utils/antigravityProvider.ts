import type { Provider, ProviderInput } from "../types";

export const ANTIGRAVITY_PROVIDER_NAME = "Google Antigravity";
export const ANTIGRAVITY_BASE_URL = "http://localhost:51122/v1";
export const ANTIGRAVITY_FALLBACK_MODELS = [
  "claude-3.5-sonnet",
  "claude-opus-4-6",
  "gemini-3.6-flash-high",
  "gemini-3.6-flash-medium",
  "gemini-3.5-flash-high",
  "gemini-3.5-flash-medium",
  "gemini-3.1-pro-high",
];

type AntigravityIdentity = Pick<ProviderInput, "kind" | "name" | "baseUrl" | "apiFormat">;

export function isAntigravityProvider(provider: Provider | AntigravityIdentity) {
  return provider.kind === "custom"
    && provider.name.trim() === ANTIGRAVITY_PROVIDER_NAME
    && provider.apiFormat === "openaiResponses"
    && isAntigravityBaseUrl(provider.baseUrl);
}

function isAntigravityBaseUrl(value: string) {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/, "");
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
    return url.protocol === "http:"
      && isLoopback
      && url.port === "51122"
      && path === "/v1"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

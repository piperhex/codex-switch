import type { ProviderApiFormat, ProviderInput } from "../types";

export type ProviderPresetId =
  | "openRouter"
  | "kimi"
  | "gemini"
  | "bailian"
  | "ollama"
  | "lmStudio"
  | "glm"
  | "miniMax"
  | "mistral"
  | "volcengine";

export type ProviderPresetTag = "official" | "local" | "aggregator" | "codingPlan";

export type ProviderCatalogTranslationKey =
  `providers.catalog.${ProviderPresetId}.${"description" | "note"}`;

export type ProviderEndpointTranslationKey = `providers.catalog.endpoint.${
  | "global"
  | "china"
  | "international"
  | "local"
  | "codingChina"
  | "codingInternational"
  | "paygChina"
  | "paygInternational"
  | "paygUnitedStates"
  | "standardChina"
  | "standardInternational"
  | "agentPlanChina"
  | "codingPlanChina"
  | "europe"
  | "modelArkChina"
  | "bytePlusInternational"}`;

export type ProviderIdentity = Pick<
  ProviderInput,
  "kind" | "name" | "baseUrl" | "apiFormat"
>;

export interface ProviderEndpointDescriptor {
  id: string;
  labelKey: ProviderEndpointTranslationKey;
  baseUrl: string;
  apiFormat: ProviderApiFormat;
  fallbackModels: readonly string[];
}

export interface ProviderPresetDescriptor {
  id: ProviderPresetId;
  displayName: string;
  endpoints: readonly ProviderEndpointDescriptor[];
  defaultBaseUrl: string;
  baseUrlEditable: boolean;
  apiKeyRequired: boolean;
  modelsAvailable: boolean;
  tag: ProviderPresetTag;
  descriptionKey: ProviderCatalogTranslationKey;
  noteKey: ProviderCatalogTranslationKey;
  isIdentity: (provider: ProviderIdentity) => boolean;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function createOfficialIdentity(
  name: string,
  endpoints: readonly ProviderEndpointDescriptor[],
): (provider: ProviderIdentity) => boolean {
  return (provider) => {
    if (provider.kind !== "custom" || provider.name.trim() !== name) return false;
    const baseUrl = normalizeBaseUrl(provider.baseUrl);
    return endpoints.some((endpoint) => (
      normalizeBaseUrl(endpoint.baseUrl) === baseUrl
      && endpoint.apiFormat === provider.apiFormat
    ));
  };
}

function isValidLocalBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim());
    const hasUnsupportedParts = Boolean(url.username || url.password || url.search || url.hash);
    const path = url.pathname.replace(/\/+$/, "");
    return !hasUnsupportedParts
      && url.protocol === "http:"
      && LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
      && Boolean(url.port)
      && path === "/v1";
  } catch {
    return false;
  }
}

function createLocalIdentity(
  name: string,
  apiFormat: ProviderApiFormat,
): (provider: ProviderIdentity) => boolean {
  return (provider) => (
    provider.kind === "custom"
    && provider.name.trim() === name
    && provider.apiFormat === apiFormat
    && isValidLocalBaseUrl(provider.baseUrl)
  );
}

const OPEN_ROUTER_ENDPOINTS = [
  {
    id: "global",
    labelKey: "providers.catalog.endpoint.global",
    baseUrl: "https://openrouter.ai/api/v1",
    apiFormat: "openaiResponses",
    fallbackModels: ["~openai/gpt-latest"],
  },
] as const satisfies readonly ProviderEndpointDescriptor[];

const KIMI_ENDPOINTS = [
  {
    id: "global",
    labelKey: "providers.catalog.endpoint.global",
    baseUrl: "https://api.moonshot.ai/v1",
    apiFormat: "openaiChat",
    fallbackModels: ["kimi-k3", "kimi-k2.7-code"],
  },
  {
    id: "china",
    labelKey: "providers.catalog.endpoint.china",
    baseUrl: "https://api.moonshot.cn/v1",
    apiFormat: "openaiChat",
    fallbackModels: ["kimi-k3", "kimi-k2.7-code"],
  },
] as const satisfies readonly ProviderEndpointDescriptor[];

const GEMINI_ENDPOINTS = [
  {
    id: "global",
    labelKey: "providers.catalog.endpoint.global",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiFormat: "openaiChat",
    fallbackModels: ["gemini-3.7-flash"],
  },
] as const satisfies readonly ProviderEndpointDescriptor[];

const BAILIAN_ENDPOINTS = [
  {
    id: "codingChina",
    labelKey: "providers.catalog.endpoint.codingChina",
    baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
    apiFormat: "openaiChat",
    fallbackModels: ["qwen3.7-plus", "qwen3.6-plus", "kimi-k2.5", "glm-5", "MiniMax-M2.5"],
  },
  {
    id: "codingInternational",
    labelKey: "providers.catalog.endpoint.codingInternational",
    baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1",
    apiFormat: "openaiChat",
    fallbackModels: ["qwen3.7-plus", "qwen3.6-plus", "kimi-k2.5", "glm-5", "MiniMax-M2.5"],
  },
  {
    id: "paygChina",
    labelKey: "providers.catalog.endpoint.paygChina",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiFormat: "openaiResponses",
    fallbackModels: ["qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus", "qwen3.5-plus"],
  },
  {
    id: "paygInternational",
    labelKey: "providers.catalog.endpoint.paygInternational",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    apiFormat: "openaiResponses",
    fallbackModels: ["qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus", "qwen3.5-plus"],
  },
  {
    id: "paygUnitedStates",
    labelKey: "providers.catalog.endpoint.paygUnitedStates",
    baseUrl: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
    apiFormat: "openaiResponses",
    fallbackModels: ["qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus", "qwen3.5-plus"],
  },
] as const satisfies readonly ProviderEndpointDescriptor[];

const OLLAMA_ENDPOINTS = [
  {
    id: "local",
    labelKey: "providers.catalog.endpoint.local",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiFormat: "openaiResponses",
    fallbackModels: [],
  },
] as const satisfies readonly ProviderEndpointDescriptor[];

const LM_STUDIO_ENDPOINTS = [
  {
    id: "local",
    labelKey: "providers.catalog.endpoint.local",
    baseUrl: "http://127.0.0.1:1234/v1",
    apiFormat: "openaiResponses",
    fallbackModels: [],
  },
] as const satisfies readonly ProviderEndpointDescriptor[];

const GLM_ENDPOINTS = [
  {
    id: "standard",
    labelKey: "providers.catalog.endpoint.standardChina",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiFormat: "openaiChat",
    fallbackModels: ["glm-5.2", "glm-5.1"],
  },
  {
    id: "coding",
    labelKey: "providers.catalog.endpoint.codingChina",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    apiFormat: "openaiChat",
    fallbackModels: ["glm-5.2", "glm-5.1"],
  },
  {
    id: "international",
    labelKey: "providers.catalog.endpoint.standardInternational",
    baseUrl: "https://api.z.ai/api/paas/v4",
    apiFormat: "openaiChat",
    fallbackModels: ["glm-5.1"],
  },
] as const satisfies readonly ProviderEndpointDescriptor[];

const MINI_MAX_ENDPOINTS = [
  {
    id: "china",
    labelKey: "providers.catalog.endpoint.china",
    baseUrl: "https://api.minimaxi.com/v1",
    apiFormat: "openaiChat",
    fallbackModels: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5"],
  },
  {
    id: "international",
    labelKey: "providers.catalog.endpoint.international",
    baseUrl: "https://api.minimax.io/v1",
    apiFormat: "openaiChat",
    fallbackModels: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5"],
  },
] as const satisfies readonly ProviderEndpointDescriptor[];

const MISTRAL_ENDPOINTS = [
  {
    id: "global",
    labelKey: "providers.catalog.endpoint.global",
    baseUrl: "https://api.mistral.ai/v1",
    apiFormat: "openaiChat",
    fallbackModels: ["devstral-latest", "devstral-small-latest", "codestral-latest"],
  },
  {
    id: "europe",
    labelKey: "providers.catalog.endpoint.europe",
    baseUrl: "https://api.eu.mistral.ai/v1",
    apiFormat: "openaiChat",
    fallbackModels: ["devstral-latest", "devstral-small-latest", "codestral-latest"],
  },
] as const satisfies readonly ProviderEndpointDescriptor[];

const VOLCENGINE_ENDPOINTS = [
  {
    id: "agentPlanChina",
    labelKey: "providers.catalog.endpoint.agentPlanChina",
    baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    apiFormat: "openaiResponses",
    fallbackModels: [
      "doubao-seed-2-0-code-preview-260215",
      "doubao-seed-2-0-pro-260215",
      "doubao-seed-2-0-lite-260215",
    ],
  },
  {
    id: "codingPlanChina",
    labelKey: "providers.catalog.endpoint.codingPlanChina",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    apiFormat: "openaiResponses",
    fallbackModels: [
      "doubao-seed-2-0-code-preview-260215",
      "doubao-seed-2-0-pro-260215",
      "doubao-seed-2-0-lite-260215",
    ],
  },
  {
    id: "china",
    labelKey: "providers.catalog.endpoint.modelArkChina",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiFormat: "openaiResponses",
    fallbackModels: [
      "doubao-seed-2-0-code-preview-260215",
      "doubao-seed-2-0-pro-260215",
      "doubao-seed-2-0-lite-260215",
    ],
  },
  {
    id: "international",
    labelKey: "providers.catalog.endpoint.bytePlusInternational",
    baseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3",
    apiFormat: "openaiResponses",
    fallbackModels: [
      "seed-2-0-code-preview-260328",
      "seed-2-0-pro-260328",
      "seed-2-0-lite-260228",
    ],
  },
] as const satisfies readonly ProviderEndpointDescriptor[];

export const PROVIDER_CATALOG = {
  openRouter: {
    id: "openRouter",
    displayName: "OpenRouter",
    endpoints: OPEN_ROUTER_ENDPOINTS,
    defaultBaseUrl: OPEN_ROUTER_ENDPOINTS[0].baseUrl,
    baseUrlEditable: false,
    apiKeyRequired: true,
    modelsAvailable: true,
    tag: "aggregator",
    descriptionKey: "providers.catalog.openRouter.description",
    noteKey: "providers.catalog.openRouter.note",
    isIdentity: createOfficialIdentity("OpenRouter", OPEN_ROUTER_ENDPOINTS),
  },
  kimi: {
    id: "kimi",
    displayName: "Kimi",
    endpoints: KIMI_ENDPOINTS,
    defaultBaseUrl: KIMI_ENDPOINTS[0].baseUrl,
    baseUrlEditable: false,
    apiKeyRequired: true,
    modelsAvailable: true,
    tag: "official",
    descriptionKey: "providers.catalog.kimi.description",
    noteKey: "providers.catalog.kimi.note",
    isIdentity: createOfficialIdentity("Kimi", KIMI_ENDPOINTS),
  },
  gemini: {
    id: "gemini",
    displayName: "Gemini API",
    endpoints: GEMINI_ENDPOINTS,
    defaultBaseUrl: GEMINI_ENDPOINTS[0].baseUrl,
    baseUrlEditable: false,
    apiKeyRequired: true,
    modelsAvailable: true,
    tag: "official",
    descriptionKey: "providers.catalog.gemini.description",
    noteKey: "providers.catalog.gemini.note",
    isIdentity: createOfficialIdentity("Gemini API", GEMINI_ENDPOINTS),
  },
  bailian: {
    id: "bailian",
    displayName: "Alibaba Cloud Model Studio",
    endpoints: BAILIAN_ENDPOINTS,
    defaultBaseUrl: BAILIAN_ENDPOINTS[0].baseUrl,
    baseUrlEditable: false,
    apiKeyRequired: true,
    modelsAvailable: false,
    tag: "codingPlan",
    descriptionKey: "providers.catalog.bailian.description",
    noteKey: "providers.catalog.bailian.note",
    isIdentity: createOfficialIdentity("Alibaba Cloud Model Studio", BAILIAN_ENDPOINTS),
  },
  ollama: {
    id: "ollama",
    displayName: "Ollama",
    endpoints: OLLAMA_ENDPOINTS,
    defaultBaseUrl: OLLAMA_ENDPOINTS[0].baseUrl,
    baseUrlEditable: true,
    apiKeyRequired: false,
    modelsAvailable: true,
    tag: "local",
    descriptionKey: "providers.catalog.ollama.description",
    noteKey: "providers.catalog.ollama.note",
    isIdentity: createLocalIdentity("Ollama", "openaiResponses"),
  },
  lmStudio: {
    id: "lmStudio",
    displayName: "LM Studio",
    endpoints: LM_STUDIO_ENDPOINTS,
    defaultBaseUrl: LM_STUDIO_ENDPOINTS[0].baseUrl,
    baseUrlEditable: true,
    apiKeyRequired: false,
    modelsAvailable: true,
    tag: "local",
    descriptionKey: "providers.catalog.lmStudio.description",
    noteKey: "providers.catalog.lmStudio.note",
    isIdentity: createLocalIdentity("LM Studio", "openaiResponses"),
  },
  glm: {
    id: "glm",
    displayName: "GLM",
    endpoints: GLM_ENDPOINTS,
    defaultBaseUrl: GLM_ENDPOINTS[0].baseUrl,
    baseUrlEditable: false,
    apiKeyRequired: true,
    modelsAvailable: false,
    tag: "codingPlan",
    descriptionKey: "providers.catalog.glm.description",
    noteKey: "providers.catalog.glm.note",
    isIdentity: createOfficialIdentity("GLM", GLM_ENDPOINTS),
  },
  miniMax: {
    id: "miniMax",
    displayName: "MiniMax",
    endpoints: MINI_MAX_ENDPOINTS,
    defaultBaseUrl: MINI_MAX_ENDPOINTS[0].baseUrl,
    baseUrlEditable: false,
    apiKeyRequired: true,
    modelsAvailable: true,
    tag: "official",
    descriptionKey: "providers.catalog.miniMax.description",
    noteKey: "providers.catalog.miniMax.note",
    isIdentity: createOfficialIdentity("MiniMax", MINI_MAX_ENDPOINTS),
  },
  mistral: {
    id: "mistral",
    displayName: "Mistral",
    endpoints: MISTRAL_ENDPOINTS,
    defaultBaseUrl: MISTRAL_ENDPOINTS[0].baseUrl,
    baseUrlEditable: false,
    apiKeyRequired: true,
    modelsAvailable: true,
    tag: "official",
    descriptionKey: "providers.catalog.mistral.description",
    noteKey: "providers.catalog.mistral.note",
    isIdentity: createOfficialIdentity("Mistral", MISTRAL_ENDPOINTS),
  },
  volcengine: {
    id: "volcengine",
    displayName: "Volcengine ModelArk",
    endpoints: VOLCENGINE_ENDPOINTS,
    defaultBaseUrl: VOLCENGINE_ENDPOINTS[0].baseUrl,
    baseUrlEditable: false,
    apiKeyRequired: true,
    modelsAvailable: true,
    tag: "official",
    descriptionKey: "providers.catalog.volcengine.description",
    noteKey: "providers.catalog.volcengine.note",
    isIdentity: createOfficialIdentity("Volcengine ModelArk", VOLCENGINE_ENDPOINTS),
  },
} as const satisfies Record<ProviderPresetId, ProviderPresetDescriptor>;

export const PROVIDER_PRESETS: readonly ProviderPresetDescriptor[] = Object.values(PROVIDER_CATALOG);

export function findProviderPreset(
  provider: ProviderIdentity,
): ProviderPresetDescriptor | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.isIdentity(provider));
}

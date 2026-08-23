import type {
  ClaudeSubagentModel,
  ClaudeCodeWriteTarget,
  ThirdPartyAppId,
  ThirdPartyAppWriteSettings,
} from "../types";

export const THIRD_PARTY_APP_IDS = [
  "claudeCode",
  "openCode",
  "openClaw",
  "hermesAgent",
  "trae",
  "workBuddy",
  "zCode",
  "deepSeekHarness",
  "openViking",
] as const satisfies readonly ThirdPartyAppId[];

interface ThirdPartyAppWriteSettingsInput {
  enabled?: boolean;
  writeCodex?: boolean;
  apps?: Partial<Record<ThirdPartyAppId, boolean>>;
  claudeSubagentModel?: ClaudeSubagentModel;
}

export function createThirdPartyAppSelection(
  claudeCode = false,
): Record<ThirdPartyAppId, boolean> {
  return {
    claudeCode,
    openCode: false,
    openClaw: false,
    hermesAgent: false,
    trae: false,
    workBuddy: false,
    zCode: false,
    deepSeekHarness: false,
    openViking: false,
  };
}

export function defaultThirdPartyAppWriteSettings(): ThirdPartyAppWriteSettings {
  return {
    enabled: false,
    writeCodex: true,
    apps: createThirdPartyAppSelection(),
    claudeSubagentModel: "sol",
  };
}

export function settingsFromLegacyTarget(
  target: ClaudeCodeWriteTarget = "codex",
): ThirdPartyAppWriteSettings {
  const writesClaudeCode = target === "all" || target === "claudeCode";
  return {
    enabled: writesClaudeCode,
    writeCodex: target !== "claudeCode",
    apps: createThirdPartyAppSelection(writesClaudeCode),
    claudeSubagentModel: "sol",
  };
}

export function normalizeThirdPartyAppWriteSettings(
  settings: ThirdPartyAppWriteSettingsInput | null | undefined,
  legacyTarget?: ClaudeCodeWriteTarget,
): ThirdPartyAppWriteSettings {
  if (!settings) return settingsFromLegacyTarget(legacyTarget);
  const fallback = defaultThirdPartyAppWriteSettings();
  const apps = createThirdPartyAppSelection();
  for (const appId of THIRD_PARTY_APP_IDS) {
    apps[appId] = settings.apps?.[appId] ?? fallback.apps[appId];
  }
  return {
    enabled: settings.enabled ?? fallback.enabled,
    writeCodex: settings.writeCodex ?? fallback.writeCodex,
    apps,
    claudeSubagentModel: settings.claudeSubagentModel ?? fallback.claudeSubagentModel,
  };
}

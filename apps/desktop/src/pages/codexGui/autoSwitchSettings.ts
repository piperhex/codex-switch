import { invoke } from "../../api/backend";

export interface GuiAutoSwitchAccountRule {
  accountId: string;
  enabled: boolean;
  priority: number;
  thresholdPercent: number;
}

export interface GuiAutoSwitchSettings {
  enabled: boolean;
  switchOnQuotaExhaustion: boolean;
  minimumRemainingPercent: number;
  mode: "sequential" | "concurrent";
  fallbackProviderId: string | null;
  accounts: GuiAutoSwitchAccountRule[];
}

export const MIN_AUTO_SWITCH_PRIORITY = -1_000_000;
export const MAX_AUTO_SWITCH_PRIORITY = 1_000_000;
export const MAX_REMAINING_PERCENT = 100;

export const loadGuiAutoSwitchSettings = () =>
  invoke<GuiAutoSwitchSettings>("codex_gui_auto_switch_settings");

export const saveGuiAutoSwitchSettings = (settings: GuiAutoSwitchSettings) =>
  invoke<GuiAutoSwitchSettings>("codex_gui_set_auto_switch_settings", { settings });

export function guiAccountRule(settings: GuiAutoSwitchSettings, accountId: string): GuiAutoSwitchAccountRule {
  return settings.accounts.find((rule) => rule.accountId === accountId)
    ?? { accountId, enabled: true, priority: 0, thresholdPercent: 0 };
}

export function updateGuiAccountRule(settings: GuiAutoSwitchSettings, rule: GuiAutoSwitchAccountRule) {
  return { ...settings, accounts: [...settings.accounts.filter((entry) => entry.accountId !== rule.accountId), rule] };
}

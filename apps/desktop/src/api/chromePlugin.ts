import { invoke } from "./backend";

export interface ChromePluginStatus {
  installed: boolean;
  enabled: boolean;
  needsRepair: boolean;
  connectedBrowsers: number;
  activeBrowsers: number;
  version: string;
  supported: boolean;
  extensionDirectory: string;
}

export type ChromePluginAction = "install" | "enable" | "disable" | "remove" | "openFolder" | "openExtensions";

export function chromePluginStatus(homeId: string) {
  return invoke<ChromePluginStatus>("chrome_plugin_status", { homeId });
}

export function chromePluginAction(homeId: string, action: ChromePluginAction) {
  return invoke<ChromePluginStatus>("chrome_plugin_action", { homeId, action });
}

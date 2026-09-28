import { invoke } from "./backend";

export interface RemoteCommandStatus {
  installed: boolean;
  enabled: boolean;
  needsRepair: boolean;
  version: string;
}

export type RemoteCommandAction = "install" | "enable" | "disable" | "remove";

export function remoteCommandStatus(homeId: string) {
  return invoke<RemoteCommandStatus>("remote_command_status", { homeId });
}

export function remoteCommandAction(homeId: string, action: RemoteCommandAction) {
  return invoke<RemoteCommandStatus>("remote_command_action", { homeId, action });
}

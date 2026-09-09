import { invoke } from "./backend";

export interface ComputerUseStatus {
  installed: boolean;
  enabled: boolean;
  needsRepair: boolean;
  supported: boolean;
  version: string;
}

export type ComputerUseAction = "install" | "enable" | "disable" | "remove";

export function computerUseStatus(homeId: string) {
  return invoke<ComputerUseStatus>("computer_use_status", { homeId });
}

export function computerUseAction(homeId: string, action: ComputerUseAction) {
  return invoke<ComputerUseStatus>("computer_use_action", { homeId, action });
}

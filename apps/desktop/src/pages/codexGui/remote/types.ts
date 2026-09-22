export type { ChatComputer as GuiComputer } from '../../../../../../shared/remote-chat/devices';
import type { ChatComputer as GuiComputer } from '../../../../../../shared/remote-chat/devices';
export interface GuiCloudIdentity { baseUrl: string; userId: string }
export interface GuiDeviceDirectory {
  identity: GuiCloudIdentity | null;
  currentDeviceId: string;
  devices: GuiComputer[];
}
export interface GuiComputerNavigation {
  current: GuiComputer | null;
  devices: GuiComputer[];
  authenticated: boolean;
  loading: boolean;
  error: string;
  refresh: () => void;
  choose: (device: GuiComputer | null) => void;
  login: () => void;
}

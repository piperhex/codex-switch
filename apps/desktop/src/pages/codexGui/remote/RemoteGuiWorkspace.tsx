import type { ReactNode } from 'react';
import { ConnectedChat } from '../../../../../web/src/chat/ConnectedChat';
import { FocusModeButton, type GuiFocusMode } from '../FocusModeButton';
import { RemoteAccountPicker } from './RemoteAccountPicker';
import { useRemoteGui } from './useRemoteGui';
import type { GuiCloudIdentity, GuiComputer, GuiComputerNavigation } from './types';
import './remoteGui.less';

export default function RemoteGuiWorkspace(props: {
  active: boolean; identity: GuiCloudIdentity; device: GuiComputer; computers: GuiComputerNavigation;
  privacyMode: boolean; focusMode: GuiFocusMode; windowControls?: ReactNode;
}) {
  const { active, identity, device, computers } = props;
  const chat = useRemoteGui(identity, device.deviceId, active);
  return <section className="chat-page gui-remote-workspace" aria-label={`Codex GUI：${device.name}`}>
    <ConnectedChat chat={chat} active={active} device={device} devices={computers.devices} email=""
      scope={JSON.stringify([identity.baseUrl, identity.userId, device.deviceId])}
      chooseLocal={() => computers.choose(null)}
      chooseDevice={(id) => { const device = computers.devices.find((entry) => entry.deviceId === id);
        if (device) computers.choose(device); }}
      headerActions={<><FocusModeButton {...props.focusMode} />{props.focusMode.focused && props.windowControls}</>}
      accountPicker={<RemoteAccountPicker active={active} ready={chat.state.ready} client={chat.controller.guiAccounts}
        computers={computers} privacyMode={props.privacyMode} />} />
  </section>;
}

import { useCallback, useRef, type ReactNode } from 'react';
import { ConfigProvider } from 'antd';
import { ConnectedChat } from '../../../../../web/src/chat/ConnectedChat';
import { FocusModeButton, type GuiFocusMode } from '../FocusModeButton';
import { RemoteAccountPicker } from './RemoteAccountPicker';
import { useRemoteGui } from './useRemoteGui';
import type { GuiCloudIdentity, GuiComputer, GuiComputerNavigation } from './types';
import { useDreamSkin } from '../useDreamSkin';
import { RemoteGuiSidebar } from './RemoteGuiSidebar';
import { RemoteGuiProject } from './RemoteGuiProject';
import { readRemoteClipboardImages } from './clipboardImages';
import styles from '../styles.module.less';
import './remoteGui.less';

export default function RemoteGuiWorkspace(props: {
  active: boolean; identity: GuiCloudIdentity; device: GuiComputer; computers: GuiComputerNavigation;
  privacyMode: boolean; focusMode: GuiFocusMode; windowControls?: ReactNode;
}) {
  const { active, identity, device, computers } = props;
  const chat = useRemoteGui(identity, device.deviceId, active);
  const skinStyle = useDreamSkin(active);
  const workspace = useRef<HTMLElement>(null);
  const popupContainer = useCallback(() => workspace.current ?? document.body, []);
  const accountPicker = <RemoteAccountPicker active={active} ready={chat.state.ready}
    client={chat.controller.guiAccounts} computers={computers} privacyMode={props.privacyMode} />;
  return <section ref={workspace} className={`${styles.page} chat-page gui-remote-workspace`}
    data-dream-skin={skinStyle ? 'true' : undefined} style={skinStyle} aria-label={`Codex GUI：${device.name}`}>
    <ConfigProvider getPopupContainer={popupContainer}>
    <ConnectedChat chat={chat} active={active} device={device} devices={computers.devices} email=""
      scope={JSON.stringify([identity.baseUrl, identity.userId, device.deviceId])}
      chooseLocal={() => computers.choose(null)}
      chooseDevice={(id) => { const device = computers.devices.find((entry) => entry.deviceId === id);
        if (device) computers.choose(device); }}
      headerActions={<><FocusModeButton {...props.focusMode} />{props.focusMode.focused && props.windowControls}</>}
      readClipboardImages={readRemoteClipboardImages}
      composerHeader={<RemoteGuiProject state={chat.state} controller={chat.controller} deviceName={device.name}
        active={active} />}
      renderSidebar={actions => <RemoteGuiSidebar state={chat.state} controller={chat.controller}
        actions={actions} accountPicker={accountPicker} focusMode={props.focusMode} />} />
    </ConfigProvider>
  </section>;
}

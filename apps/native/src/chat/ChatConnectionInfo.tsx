import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RemoteDevice } from '../types';
import type { ChatState } from './types';
import type { ChatController } from '../../../../shared/remote-chat/client/controller';
import { ChatProjectPicker } from './ChatProjectPicker';
import { ChatReconnectButton } from './ChatReconnectButton';
import { styles } from './styles';

const modeLabels = { connecting: '正在连接…', direct: 'P2P', relay: 'Relay', offline: '等待重新连接' };

export function ChatConnectionInfo({ state, controller, device, active }: {
  state: ChatState; controller: ChatController; device?: RemoteDevice; active: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const canChoose = active && state.ready && !state.selected && !state.sending;
  const canReconnect = active && device && !state.ready && !state.connecting && state.mode !== 'connecting';
  let status = modeLabels[state.mode];
  if (!state.ready && (state.mode === 'direct' || state.mode === 'relay')) status = '正在同步聊天…';
  if (!state.ready && state.error && !state.connecting) status = '连接未完成';
  useEffect(() => { if (!canChoose) setPicking(false); }, [canChoose]);
  return <>
    <View style={connectionStyles.row}>
      <Text numberOfLines={1} style={[styles.headerMeta, connectionStyles.status,
        canReconnect && connectionStyles.reconnectingStatus]}>
        {device ? `${device.name} · ${canReconnect ? '' : status}` : '选择电脑，开始聊天'}</Text>
      {canReconnect && <ChatReconnectButton retryAt={state.retryAt} onPress={controller.connectNow} />}
      {!state.selected && !canReconnect && <>
        <Text style={styles.headerMeta}> · </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="选择项目" disabled={!canChoose}
          style={connectionStyles.project} onPress={() => setPicking(true)}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.headerMeta}>
            {state.draftProject?.label || '未选择项目'}</Text>
        </Pressable>
      </>}
    </View>
    {picking && canChoose && <ChatProjectPicker cwd={state.draftProject?.cwd}
      load={controller.loadProjectDirectories} close={() => setPicking(false)}
      choose={(project) => { controller.chooseDraftProject(project); setPicking(false); }} />}
  </>;
}

const connectionStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  status: { flexShrink: 1 },
  reconnectingStatus: { maxWidth: '40%' },
  project: { flexShrink: 1, minWidth: 0, maxWidth: '60%' },
});

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RemoteDevice } from '../types';
import type { ChatState } from './types';
import type { ChatController } from '../../../../shared/remote-chat/client/controller';
import { ChatProjectPicker } from './ChatProjectPicker';
import { styles } from './styles';

const modeLabels = { connecting: '正在连接…', direct: 'P2P', relay: 'Relay', offline: '等待重新连接' };

export function ChatConnectionInfo({ state, controller, device, active }: {
  state: ChatState; controller: ChatController; device?: RemoteDevice; active: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const canChoose = active && state.ready && !state.selected && !state.sending;
  useEffect(() => { if (!canChoose) setPicking(false); }, [canChoose]);
  return <>
    <View style={connectionStyles.row}>
      <Text numberOfLines={1} style={[styles.headerMeta, connectionStyles.status]}>
        {device ? `${device.name} · ${!state.ready && state.mode !== 'offline'
          ? '正在同步聊天…' : modeLabels[state.mode]}` : '选择电脑，开始聊天'}</Text>
      {!state.selected && <>
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
  project: { flexShrink: 1, minWidth: 0, maxWidth: '60%' },
});

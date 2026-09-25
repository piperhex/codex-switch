import { ActivityIndicator, Keyboard, Pressable, ScrollView, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { MAX_REMOTE_TERMINALS } from '../../../../shared/remote-chat/useRemoteTerminalPanel';
import { useRemoteTerminalLauncher } from '../../../../shared/remote-chat/useRemoteTerminalLauncher';
import { TerminalSession } from './terminal/TerminalSession';
import { terminalStyles as styles } from './terminal/styles';
import { BottomSheet } from '../components/BottomSheet';
import { palette } from './styles';

/** Project views may disappear; shells stay on their PC until the user explicitly closes them. */
export function ChatTerminal({ client, cwd, active, connected, deviceName }: {
  client: GuiToolsClient['terminal']; cwd: string; active: boolean; connected: boolean; deviceName?: string;
}) {
  const panel = useRemoteTerminalLauncher({ client, cwd, connected });
  const selected = panel.tabs.find(tab => tab.id === panel.selected);
  const disabled = panel.busy || (!connected && !panel.tabs.length && !panel.error);
  const hide = () => { Keyboard.dismiss(); panel.hide(); };
  const show = () => { Keyboard.dismiss(); panel.toggle(); };
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="打开远程终端"
      accessibilityState={{ disabled, expanded: active && panel.open }} disabled={disabled}
      style={[styles.button, disabled && styles.disabled]} onPress={show}>
      <Ionicons name="terminal-outline" size={24} color={panel.error ? palette.danger : palette.ink} />
    </Pressable>
    {!selected && <BottomSheet visible={active && panel.open} title="远程终端" subtitle={deviceName}
      onClose={hide} maxWidth={400} actions={[{ label: panel.error ? '重试' : '新建终端',
        onPress: panel.retry, disabled: !connected, loading: panel.busy }]}>
      {panel.busy ? <ActivityIndicator color={palette.green} />
        : !!panel.error && <Text accessibilityRole="alert" style={styles.status}>{panel.error}</Text>}
    </BottomSheet>}
    {selected && <TerminalSession key={selected.id} client={client} session={selected.session} deviceName={deviceName}
      visible={active && panel.open} hide={hide} close={() => panel.remove(selected.id)} notice={panel.error}
      tabs={<ScrollView horizontal style={styles.tabs} contentContainerStyle={styles.tabItems}>
        {panel.tabs.map((tab, index) => <Pressable key={tab.id} accessibilityRole="tab"
          accessibilityLabel={`终端 ${index + 1}`} accessibilityState={{ selected: tab.id === panel.selected }}
          style={[styles.tab, tab.id === panel.selected && styles.selected]} onPress={() => panel.select(tab.id)}>
          <Text style={styles.tabLabel}>终端 {index + 1}</Text></Pressable>)}
        <Pressable accessibilityRole="button" accessibilityLabel="新建终端" style={styles.button}
          disabled={panel.busy || !connected || panel.tabs.length >= MAX_REMOTE_TERMINALS} onPress={panel.add}>
          <Ionicons name="add-outline" size={22} color="#17211b" /></Pressable>
      </ScrollView>} />}
  </>;
}

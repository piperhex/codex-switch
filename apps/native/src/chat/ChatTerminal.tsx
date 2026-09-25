import { Keyboard, Pressable, ScrollView, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { MAX_REMOTE_TERMINALS, useRemoteTerminalPanel } from '../../../../shared/remote-chat/useRemoteTerminalPanel';
import { TerminalSession } from './terminal/TerminalSession';
import { terminalStyles as styles } from './terminal/styles';

/** Views may disappear; shells stay on their PC until the user explicitly closes them. */
export function ChatTerminal({ client, cwd, active, connected, deviceName }: {
  client: GuiToolsClient['terminal']; cwd: string; active: boolean; connected: boolean; deviceName?: string;
}) {
  const panel = useRemoteTerminalPanel({ client, cwd, connected });
  const selected = panel.tabs.find(tab => tab.id === panel.selected);
  const disabled = panel.busy || (!connected && !panel.tabs.length);
  const hide = () => { Keyboard.dismiss(); panel.hide(); };
  const show = () => { Keyboard.dismiss(); panel.toggle(); };
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="打开远程终端"
      accessibilityState={{ disabled, expanded: active && panel.open }} disabled={disabled}
      style={[styles.button, disabled && styles.disabled]} onPress={show}>
      <Ionicons name="terminal-outline" size={24} color="#17211b" />
    </Pressable>
    {!!panel.error && !panel.open && <Text accessibilityRole="alert" style={styles.status}>{panel.error}</Text>}
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

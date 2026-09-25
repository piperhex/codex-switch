import { useState } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { ChatTerminal } from './ChatTerminal';
import { ChatGit } from './git/ChatGit';
import { BottomSheet } from '../components/BottomSheet';
import { palette, styles } from './styles';

interface Props {
  client: GuiToolsClient; cwd: string; active: boolean; connected: boolean; deviceName?: string;
}
export function ChatTools(props: Props) { return <ProjectTools key={props.cwd} {...props} />; }

function ProjectTools({ client, ...props }: Props) {
  const [menu, setMenu] = useState(false);
  const [launchId, setLaunchId] = useState(0);
  const [git, setGit] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="打开工具" accessibilityState={{ expanded: menu }}
      style={styles.back} onPress={() => { Keyboard.dismiss(); setMenu(true); }}>
      <Ionicons name="construct-outline" size={24} color={palette.ink} /></Pressable>
    <BottomSheet visible={menu && props.active} title="工具" onClose={() => setMenu(false)} maxWidth={400}>
      <View style={{ gap: 10, paddingBottom: 16 }}>
        <Pressable accessibilityRole="button" disabled={!props.connected}
          style={[styles.button, styles.row, !props.connected && styles.disabled]}
          onPress={() => { setMenu(false); setLaunchId(value => value + 1); }}>
          <Ionicons name="terminal-outline" size={22} color={palette.green} /><Text style={styles.buttonText}>终端</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={[styles.button, styles.row]}
          onPress={() => { setMenu(false); setGit(true); }}>
          <Ionicons name="git-branch-outline" size={22} color={palette.green} /><Text style={styles.buttonText}>Git</Text>
        </Pressable>
      </View>
    </BottomSheet>
    <ChatTerminal {...props} client={client.terminal} launchId={launchId} hideTrigger />
    {git && <ChatGit {...props} client={client.git} onClose={() => setGit(false)} />}
  </>;
}

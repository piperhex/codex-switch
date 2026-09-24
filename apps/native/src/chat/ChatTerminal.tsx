import { useState } from 'react';
import { Keyboard, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { TerminalSession } from './terminal/TerminalSession';
import { terminalStyles as styles } from './terminal/styles';

/** Keep the session in its original project until closed or the selected computer changes. */
export function ChatTerminal({ client, cwd, active, connected, deviceName }: {
  client: GuiToolsClient['terminal']; cwd: string; active: boolean; connected: boolean; deviceName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [sessionCwd, setSessionCwd] = useState<string | null>(null);
  const disabled = !connected && sessionCwd === null;
  const hide = () => { Keyboard.dismiss(); setOpen(false); };
  const show = () => {
    Keyboard.dismiss();
    if (sessionCwd === null) setSessionCwd(cwd);
    setOpen(true);
  };
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="打开远程终端"
      accessibilityState={{ disabled, expanded: active && open }} disabled={disabled}
      style={[styles.button, disabled && styles.disabled]} onPress={show}>
      <Ionicons name="terminal-outline" size={24} color="#17211b" />
    </Pressable>
    {sessionCwd !== null && <TerminalSession client={client} cwd={sessionCwd} deviceName={deviceName}
      visible={active && open} hide={hide} close={() => { hide(); setSessionCwd(null); }} />}
  </>;
}

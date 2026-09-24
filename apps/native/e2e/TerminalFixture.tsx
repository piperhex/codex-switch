// Isolated Android fixture: real drawer/WebView with a local shell simulation, no account or remote commands.
import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import type { GuiToolsClient } from '../../../shared/remote-chat/guiTools';
import type { TerminalEvent } from '../../../shared/terminal/types';
import { ChatTerminal } from '../src/chat/ChatTerminal';

function App() {
  const [fonts] = useFonts(Ionicons.font);
  const [computer, setComputer] = useState('Office');
  const [draft, setDraft] = useState('Keep this draft');
  const [opened, setOpened] = useState(0);
  const [closed, setClosed] = useState(0);
  const [input, setInput] = useState('');
  const [size, setSize] = useState('');
  const client = useMemo<GuiToolsClient['terminal']>(() => {
    let events: TerminalEvent[] = [];
    return {
      open: async cwd => {
        setOpened(value => value + 1);
        const history = Array.from({ length: 120 }, (_, index) => `History line ${index + 1}`).join('\r\n');
        const longLine = `LONG_START_${'0123456789'.repeat(12)}_LONG_END`;
        events.push({ type: 'output', data: Array.from(`${history}\r\n${longLine}\r\n$ `,
          char => char.charCodeAt(0)) });
        return { id: computer, cwd, shell: 'Fixture shell' };
      },
      write: async (_id, data) => {
        setInput(value => value + data);
        events.push({ type: 'output', data: Array.from(data, char => char.charCodeAt(0)) });
      },
      read: async () => { const next = events; events = []; return next; },
      resize: async (_id, next) => { setSize(`${next.cols} x ${next.rows}`); },
      close: async () => { setClosed(value => value + 1); },
    };
  }, [computer]);
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: '#f4f4f4' }}>
    <StatusBar style="dark" />
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
      <Text style={{ flex: 1 }}>Chat · {computer}</Text>
      {fonts && <ChatTerminal key={computer} client={client} cwd="/project" active connected deviceName={computer} />}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Switch computer" style={{ padding: 20 }}
      onPress={() => setComputer(value => value === 'Office' ? 'Home' : 'Office')}><Text>Switch computer</Text></Pressable>
    <Text accessibilityLabel={`Opened ${opened}, closed ${closed}`} style={{ padding: 20 }}>
      Opened {opened}, closed {closed}</Text>
    <Text style={{ padding: 20 }}>Input: {JSON.stringify(input)}</Text>
    <Text style={{ padding: 20 }}>Size: {size}</Text>
    <TextInput accessibilityLabel="Chat draft" value={draft} onChangeText={setDraft}
      style={{ margin: 20, padding: 16, backgroundColor: 'white' }} />
  </SafeAreaView></SafeAreaProvider>;
}

registerRootComponent(App);

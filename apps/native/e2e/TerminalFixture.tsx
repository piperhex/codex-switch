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
import type { TerminalEvent, TerminalInfo } from '../../../shared/terminal/types';
import { ChatTerminal } from '../src/chat/ChatTerminal';

function App() {
  const [fonts] = useFonts(Ionicons.font);
  const [computer, setComputer] = useState('Office');
  const [project, setProject] = useState('/project');
  const [draft, setDraft] = useState('Keep this draft');
  const [opened, setOpened] = useState(0);
  const [closed, setClosed] = useState(0);
  const [input, setInput] = useState('');
  const [size, setSize] = useState('');
  const client = useMemo<GuiToolsClient['terminal']>(() => {
    const sessions = new Map<string, { info: TerminalInfo; events: TerminalEvent[] }>();
    let sequence = 0;
    return {
      list: async cwd => [...sessions.values()].filter(session => session.info.cwd === cwd).map(session => session.info),
      open: async cwd => {
        setOpened(value => value + 1);
        const history = Array.from({ length: 120 }, (_, index) => `History line ${index + 1}`).join('\r\n');
        const longLine = `LONG_START_${'0123456789'.repeat(12)}_LONG_END`;
        const info = { id: `${computer}-${++sequence}`, cwd, projectCwd: cwd, shell: 'Fixture shell' };
        const events: TerminalEvent[] = [{ type: 'output', data: Array.from(
          `${history}\r\n${longLine}\r\nPROJECT ${cwd}\r\n$ `, char => char.charCodeAt(0)) }];
        sessions.set(info.id, { info, events });
        return info;
      },
      write: async (id, data) => {
        setInput(value => value + data);
        sessions.get(id)?.events.push({ type: 'output', data: Array.from(data, char => char.charCodeAt(0)) });
      },
      read: async (id, cursor) => ({ found: sessions.has(id), cursor: sessions.get(id)?.events.length ?? 0,
        truncated: false, events: sessions.get(id)?.events.slice(cursor) ?? [] }),
      resize: async (_id, next) => { setSize(`${next.cols} x ${next.rows}`); },
      close: async id => { sessions.delete(id); setClosed(value => value + 1); },
    };
  }, [computer]);
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: '#f4f4f4' }}>
    <StatusBar style="dark" />
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
      <Text style={{ flex: 1 }}>Chat · {computer}</Text>
      {fonts && <ChatTerminal key={computer} client={client} cwd={project} active connected deviceName={computer} />}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Switch computer" style={{ padding: 20 }}
      onPress={() => setComputer(value => value === 'Office' ? 'Home' : 'Office')}><Text>Switch computer</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Switch project" style={{ padding: 20 }}
      onPress={() => setProject(value => value === '/project' ? '/other' : '/project')}>
      <Text>Project {project}</Text></Pressable>
    <Text accessibilityLabel={`Opened ${opened}, closed ${closed}`} style={{ padding: 20 }}>
      Opened {opened}, closed {closed}</Text>
    <Text style={{ padding: 20 }}>Input: {JSON.stringify(input)}</Text>
    <Text style={{ padding: 20 }}>Size: {size}</Text>
    <TextInput accessibilityLabel="Chat draft" value={draft} onChangeText={setDraft}
      style={{ margin: 20, padding: 16, backgroundColor: 'white' }} />
  </SafeAreaView></SafeAreaProvider>;
}

registerRootComponent(App);

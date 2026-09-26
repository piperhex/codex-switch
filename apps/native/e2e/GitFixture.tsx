import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { ChatTools } from '../src/chat/ChatTools';
import { ChatOverlay } from '../src/chat/ChatOverlay';
import { createGuiToolsClient } from '../../../shared/remote-chat/guiTools';
import { createAsyncGitFixture } from '../../../shared/remote-chat/testing/gitFixture';

function App() {
  const [fonts] = useFonts(Ionicons.font);
  const client = useMemo(() => ({ ...createGuiToolsClient(async <T,>() => [] as T), git: createAsyncGitFixture() }), []);
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: '#f4f4f4' }}>
    <ChatOverlay>
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
      <Text style={{ flex: 1 }}>Git tools fixture</Text>
      {fonts && <ChatTools client={client} cwd="/projects/demo" active connected deviceName="测试电脑" />}
    </View>
    </ChatOverlay>
  </SafeAreaView></SafeAreaProvider>;
}
registerRootComponent(App);

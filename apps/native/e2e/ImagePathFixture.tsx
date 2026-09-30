import 'react-native-gesture-handler';
import { useEffect, useState } from 'react';
import { registerRootComponent } from 'expo';
import { ScrollView, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { ChatMarkdown } from '../src/chat/Markdown';
import { ChatImageContext } from '../src/chat/ChatImage';
import { ChatImagePreviewProvider } from '../src/chat/ChatImagePreview';

// Forward this dedicated test endpoint with adb reverse; never change the installed app's account or data.
const ENDPOINT = 'http://127.0.0.1:15048';
interface Fixture { threadId: string; text: string }

async function load(threadId: string, source: string, original = false): Promise<string> {
  const response = await fetch(`${ENDPOINT}/image`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId, source, original }) });
  if (!response.ok) throw new Error('图片加载失败');
  const result: { url: string } = await response.json();
  return result.url;
}

function ImagePathFixture() {
  const [fonts] = useFonts(MaterialCommunityIcons.font);
  const [fixture, setFixture] = useState<Fixture>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void fetch(`${ENDPOINT}/fixture`).then(response => response.json()).then(setFixture).catch(() => setFailed(true));
  }, []);
  if (!fonts) return null;
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider>
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f4f4f4' }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 20 }}>
        <Text style={{ fontSize: 22, fontWeight: '700' }}>图片预览验证</Text>
        {failed && <Text>暂时无法加载，请重新打开。</Text>}
        {fixture && <ChatImageContext.Provider value={{ threadId: fixture.threadId, ready: true, load }}>
          <ChatImagePreviewProvider><ChatMarkdown text={fixture.text} /></ChatImagePreviewProvider>
        </ChatImageContext.Provider>}
      </ScrollView>
    </SafeAreaView>
  </SafeAreaProvider></GestureHandlerRootView>;
}

registerRootComponent(ImagePathFixture);

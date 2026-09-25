import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { markdownAnswer, markdownQuestion } from '../../../shared/chat/markdownFixture.json';
import { ChatMessage } from '../src/chat/ChatMessage';

function MarkdownFixture() {
  const [fonts] = useFonts(Ionicons.font);
  if (!fonts) return null;
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: '#f4f4f4' }}>
    <ScrollView contentContainerStyle={{ padding: 16, gap: 20 }}>
      <Text>Markdown 显示验证</Text>
      <ChatMessage item={{ id: 'question', type: 'userMessage', text: markdownQuestion }} onOpen={() => {}} />
      <ChatMessage item={{ id: 'answer', type: 'agentMessage', text: markdownAnswer }} onOpen={() => {}} />
      <View><ChatMessage item={{ id: 'math-question', type: 'userMessage', text: String.raw`\(x^2+1\)` }}
        onOpen={() => {}} /></View>
    </ScrollView>
  </SafeAreaView></SafeAreaProvider>;
}

registerRootComponent(MarkdownFixture);

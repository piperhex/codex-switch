import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import type { Model } from './types';
import { styles } from './styles';

interface SendInput { text: string; model?: string; effort?: string; access: 'read-only' | 'workspace-write' }
interface Props {
  models: Model[];
  ready: boolean;
  sending: boolean;
  running: boolean;
  send: (input: SendInput) => Promise<boolean>;
  interrupt: () => void;
}

export function ChatComposer({ models, ready, sending, running, send, interrupt }: Props) {
  const [text, setText] = useState('');
  const [modelId, setModelId] = useState('');
  const [effort, setEffort] = useState('');
  const [access, setAccess] = useState<SendInput['access']>('workspace-write');
  const [settings, setSettings] = useState(false);
  const model = models.find((entry) => entry.model === modelId) ?? models.find((entry) => entry.isDefault) ?? models[0];
  const effortLabels: Record<string, string> = { low: '轻量', medium: '标准', high: '深入', xhigh: '更深入',
    minimal: '快速', none: '关闭', max: '最高', ultra: '极高' };
  const submit = async () => {
    const submitted = text;
    const sent = await send({ text: submitted, model: modelId || undefined,
      effort: effort || (modelId ? model?.defaultReasoningEffort : undefined), access });
    if (sent) setText((current) => current === submitted ? '' : current);
  };
  return <View style={styles.composer}>
    <TextInput accessibilityLabel="聊天消息" style={styles.input} multiline value={text} maxLength={100_000}
      onChangeText={setText} placeholder={ready ? '发消息给 Codex…' : '连接后即可发送消息'} />
    <View style={styles.row}>
      <Pressable accessibilityRole="button" style={[styles.compactButton, styles.fill]}
        onPress={() => setSettings(true)}>
        <Text numberOfLines={1} style={styles.buttonText}>{modelId ? model?.displayName : '沿用电脑模型'} ▾</Text>
      </Pressable>
      {running && <Pressable accessibilityRole="button" accessibilityLabel="停止回复" style={styles.compactButton}
        disabled={!ready} onPress={interrupt}><Text style={styles.buttonText}>停止</Text></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel={running ? '补充消息' : '发送消息'}
        disabled={!ready || sending || !text.trim()}
        style={[styles.button, styles.primary, (!ready || sending || !text.trim()) && styles.disabled]}
        onPress={() => { void submit(); }}>
        <Text style={[styles.buttonText, styles.primaryText]}>{sending ? '发送中' : running ? '补充' : '发送 ↑'}</Text>
      </Pressable>
    </View>
    <BottomSheet visible={settings} title="聊天设置" onClose={() => setSettings(false)}>
      <ScrollView contentContainerStyle={styles.settings}>
        <Text style={styles.title}>模型</Text>
        <Pressable style={[styles.choice, !modelId && styles.chosen]}
          onPress={() => { setModelId(''); setEffort(''); }}>
          <Text style={styles.buttonText}>沿用电脑设置</Text>
        </Pressable>
        {models.map((entry) => <Pressable key={entry.id} accessibilityRole="radio"
          accessibilityState={{ checked: modelId === entry.model }}
          style={[styles.choice, modelId === entry.model && styles.chosen]}
          onPress={() => { setModelId(entry.model); setEffort(''); }}>
          <Text style={styles.buttonText}>{entry.displayName}</Text>
        </Pressable>)}
        <Text style={styles.title}>思考深度</Text>
        {model?.supportedReasoningEfforts?.map((entry) => <Pressable key={entry.reasoningEffort}
          style={[styles.choice, (effort || model.defaultReasoningEffort) === entry.reasoningEffort && styles.chosen]}
          onPress={() => setEffort(entry.reasoningEffort)}>
          <Text style={styles.buttonText}>{effortLabels[entry.reasoningEffort] ?? entry.reasoningEffort}</Text>
        </Pressable>)}
        <Text style={styles.title}>文件权限</Text>
        {(['workspace-write', 'read-only'] as const).map((value) => <Pressable key={value}
          style={[styles.choice, access === value && styles.chosen]} onPress={() => setAccess(value)}>
          <Text style={styles.buttonText}>{value === 'read-only' ? '仅查看文件' : '允许编辑当前项目'}</Text>
        </Pressable>)}
      </ScrollView>
    </BottomSheet>
  </View>;
}

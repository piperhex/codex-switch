import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import type { Model } from './types';
import { styles } from './styles';
import { ACCESS_OPTIONS, EFFORT_LABELS, composerLabel,
  type ComposerSettings } from '../../../../shared/remote-chat/composer';

interface SendInput { text: string; model?: string; effort?: string; access: ComposerSettings['access'] }
interface Props {
  models: Model[];
  selection: ComposerSettings;
  settingsBusy: boolean;
  updateSettings: (settings: Partial<ComposerSettings>) => Promise<void>;
  ready: boolean;
  sending: boolean;
  running: boolean;
  send: (input: SendInput) => Promise<boolean>;
  interrupt: () => void;
}

export function ChatComposer({ models, selection, settingsBusy, updateSettings,
  ready, sending, running, send, interrupt }: Props) {
  const [text, setText] = useState('');
  const [settings, setSettings] = useState(false);
  const model = models.find((entry) => entry.model === selection.model);
  const disabled = !ready || settingsBusy;
  const submit = async () => {
    const submitted = text;
    if (disabled || sending || !submitted.trim()) return;
    const sent = await send({ text: submitted, ...selection });
    if (sent) setText((current) => current === submitted ? '' : current);
  };
  return <View style={styles.composer}>
    <TextInput accessibilityLabel="聊天消息" style={styles.input} multiline value={text} maxLength={100_000}
      onChangeText={setText} placeholder={ready ? '发消息给 Codex…' : '连接后即可发送消息'} />
    <View style={styles.row}>
      <Pressable accessibilityRole="button" style={[styles.compactButton, styles.fill]}
        accessibilityLabel={`${composerLabel(models, selection)}，聊天设置`} onPress={() => setSettings(true)}>
        <Text numberOfLines={1} style={styles.buttonText}>{composerLabel(models, selection)} ▾</Text>
      </Pressable>
      {running && <Pressable accessibilityRole="button" accessibilityLabel="停止回复" style={styles.compactButton}
        disabled={!ready} onPress={interrupt}><Text style={styles.buttonText}>停止</Text></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel={running ? '补充消息' : '发送消息'}
        disabled={disabled || sending || !text.trim()}
        style={[styles.button, styles.primary, (disabled || sending || !text.trim()) && styles.disabled]}
        onPress={() => { void submit(); }}>
        <Text style={[styles.buttonText, styles.primaryText]}>{sending ? '发送中' : running ? '补充' : '发送 ↑'}</Text>
      </Pressable>
    </View>
    <BottomSheet visible={settings} title="聊天设置" onClose={() => setSettings(false)}>
      <ScrollView contentContainerStyle={styles.settings}>
        <Text style={styles.title}>模型</Text>
        {models.map((entry) => <Pressable key={entry.id} accessibilityRole="radio"
          accessibilityState={{ checked: selection.model === entry.model, disabled }} disabled={disabled}
          style={[styles.choice, selection.model === entry.model && styles.chosen]}
          onPress={() => { void updateSettings({ model: entry.model }); }}>
          <Text style={styles.buttonText}>{entry.displayName}</Text>
        </Pressable>)}
        <Text style={styles.title}>思考深度</Text>
        {model?.supportedReasoningEfforts?.map((entry) => <Pressable key={entry.reasoningEffort}
          accessibilityRole="radio" disabled={disabled}
          accessibilityState={{ checked: selection.effort === entry.reasoningEffort, disabled }}
          style={[styles.choice, selection.effort === entry.reasoningEffort && styles.chosen]}
          onPress={() => { void updateSettings({ effort: entry.reasoningEffort }); }}>
          <Text style={styles.buttonText}>{EFFORT_LABELS[entry.reasoningEffort] ?? entry.reasoningEffort}</Text>
        </Pressable>)}
        <Text style={styles.title}>访问权限</Text>
        {ACCESS_OPTIONS.map((option) => <Pressable key={option.value} accessibilityRole="radio" disabled={disabled}
          accessibilityState={{ checked: selection.access === option.value, disabled }}
          style={[styles.choice, selection.access === option.value && styles.chosen]}
          onPress={() => { void updateSettings({ access: option.value }); }}>
          <Text style={styles.buttonText}>{option.label}</Text>
          <Text style={styles.subtitle}>{option.description}</Text>
        </Pressable>)}
      </ScrollView>
    </BottomSheet>
  </View>;
}

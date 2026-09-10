import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ChatSettings } from './ChatSettings';
import type { Model } from './types';
import { styles } from './styles';
import { composerLabel, type ComposerSettings } from '../../../../shared/remote-chat/composer';

interface SendInput { text: string; model?: string; effort?: string; access: ComposerSettings['access'] }
interface Props {
  models: Model[];
  selection: ComposerSettings;
  settingsBusy: boolean;
  settingsError: string;
  updateSettings: (settings: Partial<ComposerSettings>) => Promise<void>;
  ready: boolean;
  sending: boolean;
  running: boolean;
  send: (input: SendInput) => Promise<boolean>;
  interrupt: () => void;
}

export function ChatComposer({ models, selection, settingsBusy, settingsError, updateSettings,
  ready, sending, running, send, interrupt }: Props) {
  const [text, setText] = useState('');
  const [settings, setSettings] = useState(false);
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
    {settings && <ChatSettings models={models} selection={selection}
      saving={settingsBusy} error={settingsError} ready={ready}
      updateSettings={updateSettings} onClose={() => setSettings(false)} />}
  </View>;
}

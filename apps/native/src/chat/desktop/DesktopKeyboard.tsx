import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { DesktopInput } from '../../../../../shared/remote-desktop/protocol';
import { desktopStyles as s } from './styles';

export function DesktopKeyboard({ input, close }: { input: (input: DesktopInput) => void; close: () => void }) {
  const [text, setText] = useState('');
  const send = () => { if (text) { input({ kind: 'text', text }); setText(''); } };
  return <View style={s.keyboard}>
    <View style={s.row}><TextInput autoFocus disableFullscreenUI autoCorrect={false} autoCapitalize="none"
      returnKeyType="send" style={[s.input, { flex: 1 }]} value={text} onChangeText={setText}
      maxLength={1000} placeholder="输入文字" placeholderTextColor="#aebad0" accessibilityLabel="发送到电脑的文字"
      onSubmitEditing={send} blurOnSubmit={false} />
      <Pressable style={s.choice} onPress={send}><Text style={s.text}>发送</Text></Pressable></View>
    <View style={s.row}>{(['escape', 'tab', 'backspace', 'enter'] as const).map((key, index) =>
      <Pressable key={key} style={s.choice} onPress={() => input({ kind: 'key', key })}>
        <Text style={s.text}>{['Esc', 'Tab', '退格', '回车'][index]}</Text></Pressable>)}
      <Pressable onPress={close}><Text style={s.text}>收起</Text></Pressable></View>
  </View>;
}

import { useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import type { DesktopInput } from '../../../../../shared/remote-desktop/protocol';
import { desktopStyles as s } from './styles';

export function DesktopKeyboard({ input, close, compact }: {
  input: (input: DesktopInput) => void; close: () => void; compact: boolean;
}) {
  const [text, setText] = useState('');
  const send = () => { if (text) { input({ kind: 'text', text }); setText(''); } };
  const dismiss = () => { Keyboard.dismiss(); close(); };
  const buttonStyle = [s.choice, compact && s.keyboardButtonCompact];
  return <View style={[s.keyboard, compact && s.keyboardCompact]}>
    <View style={s.keyboardRow}><TextInput autoFocus disableFullscreenUI autoCorrect={false} autoCapitalize="none"
      returnKeyType="send" style={[s.input, s.keyboardInput, compact && s.keyboardInputCompact]}
      value={text} onChangeText={setText}
      maxLength={1000} placeholder="输入文字" placeholderTextColor="#aebad0" accessibilityLabel="发送到电脑的文字"
      onSubmitEditing={send} blurOnSubmit={false} />
      <Pressable style={buttonStyle} onPress={send}><Text style={s.text}>发送</Text></Pressable></View>
    <View style={s.keyboardRow}>{(['escape', 'tab', 'backspace', 'enter'] as const).map((key, index) =>
      <Pressable key={key} style={buttonStyle} onPress={() => input({ kind: 'key', key })}>
        <Text style={s.text}>{['Esc', 'Tab', '退格', '回车'][index]}</Text></Pressable>)}
      <Pressable style={buttonStyle} onPress={dismiss}><Text style={s.text}>收起</Text></Pressable></View>
  </View>;
}

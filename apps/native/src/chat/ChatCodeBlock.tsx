import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CopyTextButton } from './CopyTextButton';
import { styles } from './styles';

const PAGE_CHARS = 12_000;
interface Props { text: string; label?: string; lineNumbers?: boolean }

/** Limit native text layout work while keeping the entire output available to read and copy. */
export function ChatCodeBlock({ text, label = '文本', lineNumbers = false }: Props) {
  const [limit, setLimit] = useState(PAGE_CHARS);
  const [wrap, setWrap] = useState(true);
  const visible = text.slice(0, limit);
  const displayed = lineNumbers ? visible.split('\n').map((line, index) => `${index + 1}  ${line}`).join('\n') : visible;
  const content = <Text selectable style={styles.code}>{displayed || '（空文件）'}</Text>;
  return <View style={codeStyles.block}>
    <View style={codeStyles.toolbar}>
      <Text style={[styles.subtitle, styles.fill]}>{label}</Text>
      <Pressable accessibilityRole="button" onPress={() => setWrap(!wrap)} style={styles.compactButton}>
        <Text style={styles.buttonText}>{wrap ? '横向滚动' : '自动换行'}</Text></Pressable>
      <CopyTextButton text={text} />
    </View>
    {wrap ? content : <ScrollView horizontal nestedScrollEnabled>{content}</ScrollView>}
    {text.length > limit && <Pressable accessibilityRole="button" style={styles.button}
      onPress={() => setLimit(limit + PAGE_CHARS)}><Text style={styles.buttonText}>显示更多内容</Text></Pressable>}
  </View>;
}

const codeStyles = StyleSheet.create({
  block: { backgroundColor: '#eef3ef', borderRadius: 10, padding: 12, marginVertical: 8, gap: 10 },
  toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
});

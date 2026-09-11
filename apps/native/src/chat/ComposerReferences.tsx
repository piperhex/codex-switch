import { useRef } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AttachmentReference } from '../../../desktop/src/pages/codexGui/attachmentTypes';

export function ComposerReferences({ items, disabled, remove }: {
  items: AttachmentReference[]; disabled: boolean; remove: (item: AttachmentReference) => void;
}) {
  const list = useRef<ScrollView>(null);
  if (!items.length) return null;
  return <ScrollView ref={list} horizontal keyboardShouldPersistTaps="always"
    onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
    contentContainerStyle={referenceStyles.list}>
    {items.map((item, index) => <View key={`${item.path}:${index}`} style={referenceStyles.item}>
      <Feather name={item.kind === 'plugin' ? 'box' : 'file-text'} size={18} color="#555" />
      <Text numberOfLines={1} style={referenceStyles.name}>{item.name}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`移除附件 ${item.name}`}
        disabled={disabled} onPress={() => remove(item)} hitSlop={8} style={referenceStyles.remove}>
        <Feather name="x" size={16} color="#666" />
      </Pressable>
    </View>)}
  </ScrollView>;
}

const referenceStyles = StyleSheet.create({
  list: { gap: 8, padding: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingVertical: 6,
    borderRadius: 12, backgroundColor: '#f3f3f3', maxWidth: 260 },
  name: { color: '#222', fontSize: 13, flexShrink: 1 },
  remove: { minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
});

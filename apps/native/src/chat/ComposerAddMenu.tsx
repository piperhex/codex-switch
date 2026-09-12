import Feather from '@expo/vector-icons/Feather';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export type ComposerAddAction = 'camera' | 'library' | 'projectPhotos' | 'file' | 'projectFiles' | 'plugins';
const OPTIONS = [
  { action: 'camera', label: '相机', icon: 'camera' },
  { action: 'library', label: '手机照片', icon: 'image' },
  { action: 'projectPhotos', label: '电脑照片', icon: 'image' },
  { action: 'file', label: '手机文件', icon: 'paperclip' },
  { action: 'projectFiles', label: '电脑文件', icon: 'monitor' },
  { action: 'plugins', label: '插件', icon: 'box' },
] as const;

export function ComposerAddMenu({ busy, choose }: { busy: boolean; choose: (action: ComposerAddAction) => void }) {
  return <ScrollView accessibilityLabel="添加内容菜单" keyboardShouldPersistTaps="always" style={menuStyles.list}>
    {OPTIONS.map(({ action, label, icon }) => <Pressable key={action} accessibilityRole="menuitem"
      accessibilityLabel={label} disabled={busy && action !== 'plugins'} onPress={() => choose(action)}
      style={({ pressed }) => [menuStyles.option, pressed && menuStyles.pressed,
        busy && action !== 'plugins' && menuStyles.disabled]}>
      <View style={menuStyles.icon}><Feather name={icon} size={22} color="#161616" /></View>
      <Text style={menuStyles.label}>{label}</Text>
    </Pressable>)}
  </ScrollView>;
}

const menuStyles = StyleSheet.create({
  list: { flexGrow: 0, flexShrink: 1 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52, paddingHorizontal: 8,
    borderRadius: 16 },
  icon: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#f5f5f5',
    alignItems: 'center', justifyContent: 'center' },
  // Reserve enough width and leading for Android's Chinese fallback fonts.
  label: { flex: 1, fontSize: 17, lineHeight: 26, paddingVertical: 2,
    includeFontPadding: true, color: '#161616' },
  pressed: { backgroundColor: '#f2f2f2' },
  disabled: { opacity: 0.4 },
});

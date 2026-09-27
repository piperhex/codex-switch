import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DesktopStats as Stats } from '../../../../../shared/remote-desktop/protocol';
import { desktopStatsLines } from '../../../../../shared/remote-desktop/stats';

export function DesktopStats({ stats, close }: { stats: Stats; close: () => void }) {
  return <View style={s.panel} pointerEvents="box-none">
    <View pointerEvents="none" collapsable={false}><Text style={s.text} accessibilityLabel="连接状态">
      {desktopStatsLines(stats).join('\n')}</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel="关闭连接状态" onPress={close} style={s.close}>
      <Ionicons name="close" size={18} color="#cbd5e1" />
    </Pressable>
  </View>;
}
const s = StyleSheet.create({
  panel: { position: 'absolute', left: 10, top: 10, flexDirection: 'row', alignItems: 'flex-start', maxWidth: 240,
    borderRadius: 6, backgroundColor: '#080b1299' },
  text: { padding: 8, color: '#cbd5e1', fontSize: 12, lineHeight: 19,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontVariant: ['tabular-nums'] },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});

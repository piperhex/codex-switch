import { t, useLanguage } from '../i18n';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { palette } from './styles';

export function ComposerGoal({ disabled, remove }: { disabled: boolean; remove: () => void }) {
  useLanguage();
  return <View style={styles.chip} accessibilityLabel={t("目标模式")}>
    <Feather name="target" size={14} color={palette.ink} />
    <Text style={styles.text}>{t("目标")}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={t("移除目标")} disabled={disabled}
      accessibilityState={{ disabled }} hitSlop={6} onPress={remove}
      style={[styles.remove, disabled && { opacity: 0.4 }]}>
      <Feather name="x" size={14} color={palette.ink} />
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0,
    borderWidth: 1, borderColor: palette.border, borderRadius: 999, paddingLeft: 8, backgroundColor: '#f5f5f5' },
  text: { color: palette.ink, fontSize: 12 },
  remove: { padding: 7 },
});

import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { colors, styles } from './styles';

export function DownloadPageHeader({ title, back, backLabel = '返回上一级' }: {
  title: string; back: () => void; backLabel?: string;
}) {
  return <View style={styles.navigation}>
    <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={back}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
      <Ionicons name="chevron-back" size={24} color={colors.ink} />
    </Pressable>
    <Text accessibilityRole="header" style={styles.pageTitle}>{title}</Text>
    <View style={styles.back} />
  </View>;
}

import { Pressable, Text } from 'react-native';
import { reviewStyles as css } from './styles';

export function ReviewButton({ label, onPress, disabled = false }: {
  label: string; onPress: () => void; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    style={[css.action, disabled && css.disabled]} onPress={onPress}>
    <Text style={css.actionText}>{label}</Text>
  </Pressable>;
}

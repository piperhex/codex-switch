import { Pressable, StyleSheet } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import type { RequestSpeed } from '../../../../shared/remote-chat/composer';
import { nextRequestSpeed, requestSpeedLabel, speedBoltCount } from '../../../../shared/remote-chat/requestSpeed';
import { palette } from './styles';

export function RequestSpeedButton({ speed, busy, onChange }: {
  speed: RequestSpeed; busy: boolean; onChange: (speed: RequestSpeed) => void;
}) {
  const bolts = speedBoltCount(speed);
  const activeColor = speed === 'ultrafast' ? '#9560ed' : '#3984ed';
  return <Pressable accessibilityRole="button" accessibilityLabel={requestSpeedLabel(speed)}
    accessibilityState={{ disabled: busy, busy }} disabled={busy}
    style={[styles.button, busy && styles.busy]} onPress={() => onChange(nextRequestSpeed(speed))}>
    {[0, 1].map(index => <Feather key={index} name="zap" size={16}
      color={index < bolts ? activeColor : palette.muted} accessible={false} />)}
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    minWidth: 44, height: 44, borderRadius: 10 },
  busy: { opacity: .5 },
});

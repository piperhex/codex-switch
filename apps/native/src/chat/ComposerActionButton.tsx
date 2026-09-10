import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { COMPOSER_ACTION_LABELS, type ComposerAction } from '../../../../shared/remote-chat/composerAction';
import { palette, styles } from './styles';

interface Props { action: ComposerAction; disabled: boolean; busy: boolean; onPress: () => void }

export function ComposerActionButton({ action, disabled, busy, onPress }: Props) {
  return <Pressable accessibilityRole="button" accessibilityLabel={COMPOSER_ACTION_LABELS[action]}
    accessibilityState={{ disabled, busy }} disabled={disabled} onPress={onPress}
    style={[buttonStyles.button, disabled && styles.disabled]}>
    {busy ? <ActivityIndicator color="#fff" /> : <View importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden style={buttonStyles.icon}>
      {action === 'pause' && <View style={buttonStyles.pause}>
        <View style={buttonStyles.bar} /><View style={buttonStyles.bar} />
      </View>}
      {action === 'continue' && <View style={buttonStyles.play} />}
      {action === 'send' && <><View style={buttonStyles.arrowHead} /><View style={buttonStyles.arrowStem} /></>}
    </View>}
  </Pressable>;
}

const buttonStyles = StyleSheet.create({
  button: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.green,
    alignItems: 'center', justifyContent: 'center' },
  icon: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  pause: { flexDirection: 'row', gap: 5 },
  bar: { width: 4, height: 16, borderRadius: 1, backgroundColor: '#fff' },
  play: { marginLeft: 3, borderTopWidth: 9, borderBottomWidth: 9, borderLeftWidth: 14,
    borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: '#fff' },
  arrowHead: { position: 'absolute', top: 3, width: 11, height: 11, borderTopWidth: 2,
    borderLeftWidth: 2, borderColor: '#fff', transform: [{ rotate: '45deg' }] },
  arrowStem: { position: 'absolute', top: 3, width: 2, height: 16, backgroundColor: '#fff' },
});

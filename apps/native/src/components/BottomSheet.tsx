import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const AnimatedSafeAreaView = Animated.createAnimatedComponent(SafeAreaView);
const DRAG_DISMISS_DISTANCE = 80;
const DRAG_DISMISS_VELOCITY = 0.9;

export interface BottomSheetAction {
  label: string;
  onPress: () => void | Promise<void>;
  tone?: 'primary' | 'neutral' | 'danger';
  loading?: boolean;
  disabled?: boolean;
}

interface BottomSheetProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children?: ReactNode;
  actions?: BottomSheetAction[];
  dismissible?: boolean;
  tall?: boolean;
}

export function BottomSheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
  actions = [],
  dismissible = true,
  tall = false,
}: BottomSheetProps) {
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    translateY.stopAnimation();
    translateY.setValue(0);
  }, [translateY, visible]);

  const close = () => {
    if (dismissible) onClose();
  };

  const resetDrag = useCallback(() => {
    Animated.spring(translateY, {
      toValue: 0,
      damping: 22,
      stiffness: 240,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [translateY]);

  const dragResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) => (
      dismissible
      && gesture.dy > 6
      && Math.abs(gesture.dy) > Math.abs(gesture.dx)
    ),
    onPanResponderGrant: () => {
      translateY.stopAnimation();
    },
    onPanResponderMove: (_event, gesture) => {
      translateY.setValue(Math.max(0, gesture.dy));
    },
    onPanResponderRelease: (_event, gesture) => {
      const draggedFarEnough = gesture.dy >= DRAG_DISMISS_DISTANCE;
      const flickedDown = gesture.dy > 12 && gesture.vy >= DRAG_DISMISS_VELOCITY;
      if (draggedFarEnough || flickedDown) {
        onClose();
        return;
      }
      resetDrag();
    },
    onPanResponderTerminate: resetDrag,
  }), [dismissible, onClose, resetDrag, translateY]);

  return <Modal
    visible={visible}
    transparent
    animationType="slide"
    statusBarTranslucent
    onRequestClose={close}
  >
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
    >
      <Pressable accessible={false} style={styles.backdrop} onPress={close} />
      <AnimatedSafeAreaView
        edges={['bottom']}
        style={[
          styles.sheet,
          tall && styles.sheetTall,
          { transform: [{ translateY }] },
        ]}
        {...dragResponder.panHandlers}
      >
        <View>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.heading}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
            </View>
            {dismissible ? <Pressable
              accessibilityRole="button"
              accessibilityLabel={`关闭${title}`}
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable> : null}
          </View>
        </View>
        {children ? <View style={styles.content}>{children}</View> : null}
        {actions.length ? <View style={styles.actions}>
          {actions.map((action) => {
            const tone = action.tone ?? 'neutral';
            return <Pressable
              key={action.label}
              accessibilityRole="button"
              disabled={action.disabled || action.loading}
              onPress={() => void action.onPress()}
              style={({ pressed }) => [
                styles.action,
                tone === 'primary' && styles.actionPrimary,
                tone === 'danger' && styles.actionDanger,
                pressed && styles.pressed,
                (action.disabled || action.loading) && styles.disabled,
              ]}
            >
              {action.loading
                ? <ActivityIndicator color={tone === 'neutral' ? '#173128' : '#fff'} size="small" />
                : <Text style={[
                  styles.actionText,
                  tone === 'primary' && styles.actionTextOnColor,
                  tone === 'danger' && styles.actionTextOnColor,
                ]}>{action.label}</Text>}
            </Pressable>;
          })}
        </View> : null}
      </AnimatedSafeAreaView>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6, 20, 15, 0.5)' },
  sheet: {
    maxHeight: '82%',
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 9,
    paddingHorizontal: 20,
    shadowColor: '#06140f',
    shadowOpacity: 0.24,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 24,
  },
  sheetTall: { maxHeight: '92%' },
  handle: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center', backgroundColor: '#d5dfd9', marginBottom: 17 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  heading: { flex: 1, minWidth: 0 },
  title: { color: '#10251d', fontSize: 21, lineHeight: 27, fontWeight: '800' },
  subtitle: { color: '#708078', fontSize: 12, lineHeight: 18, marginTop: 4 },
  closeButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#eef3f0', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#52645b', fontSize: 25, lineHeight: 28, fontWeight: '400', marginTop: -2 },
  content: { marginTop: 19, flexShrink: 1 },
  actions: { flexDirection: 'row', gap: 10, paddingTop: 16, paddingBottom: 10 },
  action: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: '#eef3f0', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  actionPrimary: { backgroundColor: '#0b8065' },
  actionDanger: { backgroundColor: '#c84f47' },
  actionText: { color: '#173128', fontSize: 15, fontWeight: '800' },
  actionTextOnColor: { color: '#ffffff' },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.55 },
});

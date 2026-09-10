import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function ChatDrawer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const width = Math.min(useWindowDimensions().width * 0.88, 360);
  const offset = useRef(new Animated.Value(-width)).current;
  useEffect(() => {
    Animated.timing(offset, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    return () => offset.stopAnimation();
  }, [offset]);
  return <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onClose}>
    <View style={drawerStyles.root}>
      <Pressable style={drawerStyles.backdrop} accessibilityRole="button" accessibilityLabel="关闭聊天列表"
        onPress={onClose} />
      <Animated.View style={[drawerStyles.panel, { width, transform: [{ translateX: offset }] }]}>
        <SafeAreaView style={drawerStyles.root}>{children}</SafeAreaView>
      </Animated.View>
    </View>
  </Modal>;
}

const drawerStyles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6, 20, 15, 0.45)' },
  panel: { height: '100%', backgroundColor: '#fff', borderTopRightRadius: 20, borderBottomRightRadius: 20 },
});

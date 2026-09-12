import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useImageViewer } from '../../../../shared/chat/useImageViewer';
import { useImageOrientation } from './useImageOrientation';
import { useImageGestures } from './useImageGestures';
import { useSaveImage } from './useSaveImage';

interface Props { thumbnail: string; description: string; load: () => Promise<string>; close: () => void }

export function ImageViewer({ thumbnail, description, load, close }: Props) {
  const image = useImageViewer(load);
  const orientation = useImageOrientation();
  const { transform, panHandlers } = useImageGestures(close, orientation.displayed);
  const saving = useSaveImage(image.error ? undefined : image.url);
  const message = saving.message || orientation.error;
  return <Modal visible animationType="fade" onRequestClose={close} statusBarTranslucent
    navigationBarTranslucent supportedOrientations={['portrait', 'portrait-upside-down',
      'landscape-left', 'landscape-right']}>
    <SafeAreaProvider>
      <SafeAreaView style={styles.overlay}>
        <View style={styles.stage} {...panHandlers} onAccessibilityEscape={close}>
          <Image source={{ uri: image.url ?? thumbnail }} accessibilityLabel={description}
            accessibilityHint="轻点关闭，双指缩放" accessibilityActions={[{ name: 'activate', label: '关闭预览' }]}
            onAccessibilityAction={close} resizeMode="contain" onError={image.fail}
            style={[styles.image, { transform: [{ translateX: transform.x },
              { translateY: transform.y }, { scale: transform.scale }] }]} />
        </View>
        <View pointerEvents="box-none" style={styles.footer}>
          <View pointerEvents="box-none" style={styles.actions}>
            {orientation.suggested && <Pressable accessibilityRole="button" accessibilityLabel="转到手机当前方向"
              disabled={orientation.rotating} onPress={orientation.rotate} style={styles.rotate}>
              <MaterialCommunityIcons name="screen-rotation" size={28} color="#fff" />
            </Pressable>}
            <Pressable accessibilityRole="button" accessibilityLabel="保存到相册"
              accessibilityState={{ disabled: !image.url || image.error || saving.saving, busy: saving.saving }}
              disabled={!image.url || image.error || saving.saving} onPress={saving.save}
              style={[styles.save, (!image.url || image.error) && styles.disabled]}>
              {saving.saving ? <ActivityIndicator color="#fff" />
                : <MaterialCommunityIcons name="download" size={30} color="#fff" />}
            </Pressable>
          </View>
          <View pointerEvents="box-none" style={styles.notices}>
            {!!message && <Text accessibilityLiveRegion="polite" style={styles.status}>{message}</Text>}
            {!image.url && !image.error && <Text style={styles.status}>正在加载原图…</Text>}
            {image.error && <View style={styles.error}>
              <Text style={styles.status}>原图加载失败</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="重新加载原图" onPress={image.retry}
                style={styles.retry}><Text style={styles.status}>重试</Text></Pressable>
            </View>}
          </View>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000' },
  stage: { flex: 1, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  footer: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 56 },
  rotate: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  save: { marginLeft: 'auto', width: 56, height: 56, borderRadius: 28, backgroundColor: '#484848',
    alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  notices: { position: 'absolute', bottom: 96, left: 16, right: 16, alignItems: 'center', gap: 8 },
  status: { color: '#ddd', fontSize: 14, textAlign: 'center', maxWidth: 400 },
  error: { maxWidth: 400, alignItems: 'center', backgroundColor: '#222', borderRadius: 12, padding: 8 },
  retry: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});

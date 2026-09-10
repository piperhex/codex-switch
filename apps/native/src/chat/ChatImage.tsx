import { createContext, useContext, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useChatImage, type ImagePreviewOptions } from '../../../../shared/remote-chat/client/useChatImage';
import { palette, styles } from './styles';

export const ChatImageContext = createContext<ImagePreviewOptions | null>(null);
const DEFAULT_ASPECT_RATIO = 4 / 3;

export function ChatImage({ source, description = '图片' }: { source?: string; description?: string }) {
  const image = useChatImage(source, useContext(ChatImageContext));
  const [preview, setPreview] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT_RATIO);
  if (image.failed) return <View style={imageStyles.notice}>
    <Text style={styles.subtitle}>{description}：图片加载失败</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`重新加载：${description}`} onPress={image.retry}>
      <Text style={styles.buttonText}>重试</Text>
    </Pressable>
  </View>;
  if (image.loading || !image.url) return <Text style={styles.status}>正在加载图片…</Text>;
  return <View style={imageStyles.container}>
    <Pressable accessibilityRole="button" accessibilityLabel={`放大查看：${description}`}
      onPress={() => setPreview(true)}>
      <Image key={image.key} source={{ uri: image.url }} accessibilityLabel={description}
        resizeMode="contain" style={[imageStyles.thumbnail, { aspectRatio }]}
        onError={image.fail} onLoad={({ nativeEvent }) => {
          const { width, height } = nativeEvent.source;
          if (width > 0 && height > 0) setAspectRatio(width / height);
        }} />
    </Pressable>
    <Modal visible={preview} transparent animationType="fade" onRequestClose={() => setPreview(false)}>
      <View style={imageStyles.overlay}>
        <Image source={{ uri: image.url }} accessibilityLabel={description}
          resizeMode="contain" style={imageStyles.preview} />
        <Pressable accessibilityRole="button" accessibilityLabel="关闭图片" onPress={() => setPreview(false)}
          style={imageStyles.close}><Text style={imageStyles.closeText}>关闭</Text></Pressable>
      </View>
    </Modal>
  </View>;
}

const imageStyles = StyleSheet.create({
  container: { width: '100%', marginVertical: 8 },
  thumbnail: { width: '100%', maxHeight: 420, borderRadius: 12, backgroundColor: palette.pale },
  notice: { maxWidth: 400, gap: 8, paddingVertical: 10 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', justifyContent: 'center' },
  preview: { width: '100%', height: '85%' },
  close: { position: 'absolute', top: 48, right: 20, padding: 14, backgroundColor: '#fff', borderRadius: 12 },
  closeText: { color: palette.ink, fontWeight: '700' },
});

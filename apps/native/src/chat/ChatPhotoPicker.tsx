import { useEffect, useState } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { palette, styles } from './styles';
import { ImageViewer } from './ImageViewer';
import type { useChatPhotos } from './useChatPhotos';

interface Props { photos: ReturnType<typeof useChatPhotos>; disabled: boolean; active: boolean }

export function ChatPhotoPicker({ photos, disabled, active }: Props) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = photos.photos.find((photo) => photo.id === previewId);
  useEffect(() => { if (!active || !preview) setPreviewId(null); }, [active, preview]);
  const busy = disabled || photos.busy;
  if (!photos.photos.length && !photos.busy && !photos.error) return null;
  return <View style={photoStyles.container}>
    {!!photos.photos.length && <ScrollView horizontal keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false} contentContainerStyle={photoStyles.previews}>
      {photos.photos.map((photo, index) => <View key={photo.id} style={photoStyles.card}>
        <Pressable accessibilityRole="button" accessibilityLabel={`放大查看：照片 ${index + 1}`}
          style={styles.fill} onPress={() => setPreviewId(photo.id)}>
          <Image source={{ uri: photo.uri }} style={photoStyles.preview} resizeMode="cover"
            accessibilityLabel={`照片 ${index + 1}`} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`移除照片 ${index + 1}`} disabled={busy}
          accessibilityState={{ disabled: busy }} hitSlop={6} onPress={() => photos.remove(photo.id)}
          style={[photoStyles.remove, busy && styles.disabled]}>
          <Feather name="x" size={18} color={palette.ink} />
        </Pressable>
      </View>)}
    </ScrollView>}
    {photos.busy && <Text style={styles.status}>正在读取照片…</Text>}
    {!!photos.error && <Text accessibilityRole="alert" style={styles.error}>{photos.error}</Text>}
    {photos.settingsRequired && <Pressable accessibilityRole="button" onPress={photos.openSettings}>
      <Text style={styles.buttonText}>打开设置</Text>
    </Pressable>}
    {active && preview && <ImageViewer key={preview.id} thumbnail={preview.uri}
      description={`照片 ${photos.photos.indexOf(preview) + 1}`} load={async () => preview.dataUrl}
      close={() => setPreviewId(null)} />}
  </View>;
}

const photoStyles = StyleSheet.create({
  container: { gap: 8 },
  previews: { gap: 10, padding: 4 },
  card: { position: 'relative', width: 96, height: 72 },
  preview: { width: '100%', height: '100%', borderRadius: 12, backgroundColor: palette.pale },
  remove: { position: 'absolute', top: 4, right: 4, width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background,
    borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
});

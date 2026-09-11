import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { styles } from './styles';
import type { useChatPhotos } from './useChatPhotos';

interface Props { photos: ReturnType<typeof useChatPhotos>; disabled: boolean }

export function ChatPhotoPicker({ photos, disabled }: Props) {
  const busy = disabled || photos.busy;
  if (!photos.photos.length && !photos.busy && !photos.error) return null;
  return <View style={photoStyles.container}>
    {!!photos.photos.length && <ScrollView horizontal contentContainerStyle={photoStyles.previews}>
      {photos.photos.map((photo, index) => <View key={photo.id}>
        <Image source={{ uri: photo.uri }} style={photoStyles.preview} accessibilityLabel={`照片 ${index + 1}`} />
        <Pressable accessibilityRole="button" accessibilityLabel={`移除照片 ${index + 1}`} disabled={busy}
          onPress={() => photos.remove(photo.id)} style={photoStyles.remove}>
          <Text style={styles.buttonText}>移除</Text>
        </Pressable>
      </View>)}
    </ScrollView>}
    {photos.busy && <Text style={styles.status}>正在读取照片…</Text>}
    {!!photos.error && <Text accessibilityRole="alert" style={styles.error}>{photos.error}</Text>}
    {photos.settingsRequired && <Pressable accessibilityRole="button" onPress={photos.openSettings}>
      <Text style={styles.buttonText}>打开设置</Text>
    </Pressable>}
  </View>;
}

const photoStyles = StyleSheet.create({
  container: { gap: 8 },
  previews: { gap: 10 },
  preview: { width: 72, height: 72, borderRadius: 10 },
  remove: { alignItems: 'center', padding: 6 },
});

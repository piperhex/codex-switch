import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { styles } from './styles';
import type { useChatPhotos } from './useChatPhotos';

interface Props { photos: ReturnType<typeof useChatPhotos>; disabled: boolean }

export function ChatPhotoPicker({ photos, disabled }: Props) {
  const busy = disabled || photos.busy;
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
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="从相册选择照片" disabled={busy}
        style={[styles.compactButton, busy && styles.disabled]} onPress={() => { void photos.pick('library'); }}>
        <Text style={styles.buttonText}>相册</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="拍照添加到消息" disabled={busy}
        style={[styles.compactButton, busy && styles.disabled]} onPress={() => { void photos.pick('camera'); }}>
        <Text style={styles.buttonText}>拍照</Text>
      </Pressable>
      {photos.busy && <Text style={styles.status}>正在读取照片…</Text>}
    </View>
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

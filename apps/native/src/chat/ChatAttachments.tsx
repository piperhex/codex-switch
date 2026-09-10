import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { MAX_CHAT_IMAGES, type DraftImage } from '../../../../shared/remote-chat/attachments';
import { palette, styles } from './styles';

interface PreviewProps {
  images: DraftImage[]; busy: boolean; remove: (id: string) => void; add: () => void;
}
export function ChatAttachmentPreviews({ images, busy, remove, add }: PreviewProps) {
  if (!images.length) return null;
  return <ScrollView horizontal showsHorizontalScrollIndicator={false}
    keyboardShouldPersistTaps="handled" contentContainerStyle={photoStyles.previews}>
    {images.map((image, index) => <View key={image.id} style={photoStyles.preview}>
      <Image accessibilityLabel={`待发送图片 ${index + 1}`} source={{ uri: image.url }} style={photoStyles.image} />
      <Pressable accessibilityRole="button" accessibilityLabel={`移除图片 ${index + 1}`} disabled={busy}
        hitSlop={6} onPress={() => remove(image.id)} style={photoStyles.remove}>
        <Text style={photoStyles.removeText}>×</Text>
      </Pressable>
    </View>)}
    {images.length < MAX_CHAT_IMAGES && <Pressable accessibilityRole="button" accessibilityLabel="继续添加图片"
      disabled={busy} onPress={add} style={[photoStyles.preview, photoStyles.addPreview, busy && styles.disabled]}>
      <Text style={photoStyles.plus}>+</Text>
    </Pressable>}
  </ScrollView>;
}

export function ChatAttachmentSheet({ busy, pick, onClose }: {
  busy: boolean; pick: () => void; onClose: () => void;
}) {
  return <BottomSheet visible title="添加图片" onClose={onClose} dismissible={!busy}>
    <View style={photoStyles.sheet}>
      <Pressable accessibilityRole="button" accessibilityLabel="相册" disabled={busy}
        onPress={pick} style={photoStyles.album}>
        <View style={photoStyles.albumIcon}>
          {busy ? <ActivityIndicator color={palette.green} /> : <Text style={photoStyles.albumGlyph}>▧</Text>}
        </View>
        <Text style={styles.buttonText}>{busy ? '正在添加…' : '相册'}</Text>
      </Pressable>
    </View>
  </BottomSheet>;
}

export function ChatAddButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="添加图片" disabled={disabled}
    onPress={onPress} style={[photoStyles.addButton, disabled && styles.disabled]}>
    <View style={photoStyles.plusCircle}><Text style={photoStyles.plus}>+</Text></View>
  </Pressable>;
}

const photoStyles = StyleSheet.create({
  previews: { gap: 12, paddingVertical: 6, paddingRight: 6 },
  preview: { width: 64, height: 64 },
  image: { width: 64, height: 64, borderRadius: 10, backgroundColor: palette.background },
  remove: { position: 'absolute', top: -4, right: -4, width: 24, height: 24, borderRadius: 12,
    backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: '#fff', fontSize: 19, lineHeight: 22 },
  addPreview: { borderRadius: 10, borderWidth: 1, borderColor: palette.border,
    alignItems: 'center', justifyContent: 'center' },
  addButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  plusCircle: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.6, borderColor: palette.ink,
    alignItems: 'center', justifyContent: 'center' },
  plus: { color: palette.ink, fontSize: 28, lineHeight: 29, fontWeight: '300' },
  sheet: { paddingBottom: 24, minHeight: 120 },
  album: { alignItems: 'center', gap: 10, width: 80 },
  albumIcon: { width: 68, height: 68, borderRadius: 16, backgroundColor: palette.background,
    borderWidth: 1, borderColor: palette.border, alignItems: 'center', justifyContent: 'center' },
  albumGlyph: { color: palette.ink, fontSize: 36 },
});

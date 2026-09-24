import { StyleSheet, Text, View } from 'react-native';
import type { UploadProgress } from '../../../../shared/remote-chat/uploadProgress';

export function ComposerUploadProgress({ progress, reconnecting = false, inline = false }: {
  progress?: UploadProgress; reconnecting?: boolean; inline?: boolean;
}) {
  if (!progress) return null;
  let label = '上传中';
  if (progress.percent === 0) label = '待上传';
  if (progress.percent === 100) label = '已上传';
  if (progress.phase === 'preparing') label = '准备中';
  if (progress.phase === 'confirming') label = '等待确认';
  if (reconnecting && progress.percent < 100) label = '等待连接';
  return <View pointerEvents="none" style={inline ? styles.inline : styles.overlay}
    accessibilityRole="progressbar" accessibilityLabel={`附件上传进度，${label}`}
    accessibilityValue={{ min: 0, max: 100, now: progress.percent, text: `${label} ${progress.percent}%` }}>
    <Text style={[styles.percent, inline && styles.inlineText]}>{progress.percent}%</Text>
    <Text style={[styles.label, inline && styles.inlineText]}>{label}</Text>
    {!inline && <View style={styles.track}>
      <View style={[styles.fill, { width: `${progress.percent}%` }]} />
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 2,
    borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 6, backgroundColor: 'rgba(12, 24, 22, 0.6)' },
  percent: { color: '#fff', fontSize: 18, lineHeight: 24, fontWeight: '600', fontVariant: ['tabular-nums'] },
  label: { color: '#fff', fontSize: 12, lineHeight: 18, includeFontPadding: true, textAlign: 'center' },
  track: { position: 'absolute', bottom: 8, left: 10, right: 10, height: 3, borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.25)', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2, backgroundColor: '#fff' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  inlineText: { color: '#28766c', fontSize: 11, lineHeight: 18 },
});

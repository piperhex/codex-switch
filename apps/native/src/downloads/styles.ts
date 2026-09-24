import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  content: { flexShrink: 1, gap: 12, paddingBottom: 12 },
  toolbar: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', paddingVertical: 12 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14,
    borderRadius: 12, backgroundColor: '#edf4f0' },
  buttonText: { fontSize: 14, color: '#087f69', fontWeight: '600' },
  danger: { color: '#bb4444' },
  disabled: { opacity: 0.45 },
  text: { fontSize: 13, lineHeight: 20, color: '#6f8177', maxWidth: 400 },
  message: { fontSize: 13, lineHeight: 20, color: '#087f69', maxWidth: 400, marginVertical: 8 },
  error: { fontSize: 13, lineHeight: 20, color: '#bb4444', maxWidth: 400, marginVertical: 8 },
  list: { flexShrink: 1 },
  readable: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  card: { paddingVertical: 16, gap: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#dce8df' },
  title: { color: '#13231c', fontSize: 16, fontWeight: '600' },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  name: { color: '#13231c', fontSize: 15, flex: 1 },
  track: { height: 4, borderRadius: 4, backgroundColor: '#edf4f0', overflow: 'hidden' },
  progress: { height: '100%', backgroundColor: '#087f69' },
});

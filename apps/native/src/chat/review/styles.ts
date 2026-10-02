import { StyleSheet } from 'react-native';
import { palette } from '../styles';

export const reviewStyles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: palette.border, borderRadius: 14, padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  section: { paddingVertical: 16, borderBottomWidth: 1, borderColor: palette.border, gap: 12 },
  stack: { gap: 12 },
  notice: { maxWidth: 400, color: palette.muted, fontSize: 12, lineHeight: 19 },
  error: { maxWidth: 400, color: '#a55324', fontSize: 12, lineHeight: 19 },
  action: { minHeight: 40, justifyContent: 'center', alignItems: 'flex-start' },
  actionText: { color: palette.green, fontSize: 13, lineHeight: 20 },
  disabled: { opacity: 0.4 },
  confirm: { maxWidth: 400, borderRadius: 10, padding: 12, gap: 12, backgroundColor: '#f4f6f5' },
  input: { borderWidth: 1, borderColor: palette.border, borderRadius: 8, padding: 10,
    color: palette.ink, fontSize: 14, textAlignVertical: 'top', minHeight: 44 },
  form: { maxWidth: 400, gap: 12 },
  output: { maxHeight: 240, padding: 10, borderRadius: 8, backgroundColor: '#f4f6f5' },
  code: { color: palette.ink, fontSize: 12, lineHeight: 18 },
});

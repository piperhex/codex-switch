import { StyleSheet, type TextStyle } from 'react-native';
import { palette } from './styles';

export const headingStyles: Record<string, TextStyle> = {
  h1: { fontSize: 28, lineHeight: 42, marginTop: 18, marginBottom: 18 },
  h2: { fontSize: 21, lineHeight: 34, marginTop: 17, marginBottom: 17 },
  h3: { fontSize: 17, lineHeight: 28, marginTop: 16, marginBottom: 16 },
  h4: { fontSize: 14, lineHeight: 25, marginTop: 18, marginBottom: 18 },
  h5: { fontSize: 12, lineHeight: 22, marginTop: 20, marginBottom: 20 },
  h6: { fontSize: 10, lineHeight: 18, marginTop: 23, marginBottom: 23 },
};

export const markdownStyles = StyleSheet.create({
  paragraph: { marginVertical: 10 },
  compact: { marginVertical: 0 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  inlineCode: { backgroundColor: '#f4f6f5', borderRadius: 4 },
  link: { color: palette.green, textDecorationLine: 'underline' },
  quote: { borderLeftWidth: 3, borderLeftColor: palette.border, paddingLeft: 16, marginVertical: 10 },
  muted: { color: palette.muted },
  process: { color: palette.muted, fontSize: 13, lineHeight: 22 },
  list: { marginVertical: 10 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  marker: { minWidth: 16, textAlign: 'right' },
  checkbox: { width: 13, height: 13, borderWidth: 1, borderColor: palette.muted,
    borderRadius: 2, marginTop: 6, marginLeft: 3, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: palette.green, borderColor: palette.green },
  checkmark: { color: '#fff', fontSize: 10, lineHeight: 12, fontWeight: '700' },
  table: { marginVertical: 10, flexGrow: 0, flexShrink: 0 },
  tableRow: { flexDirection: 'row' },
  cell: { width: 160, paddingVertical: 6, paddingHorizontal: 12,
    borderWidth: 0.5, borderColor: palette.border },
  rule: { height: 1, backgroundColor: palette.border, marginVertical: 14 },
});

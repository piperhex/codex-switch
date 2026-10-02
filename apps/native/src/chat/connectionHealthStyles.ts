import { StyleSheet } from 'react-native';
import { palette } from './styles';

export const healthTones = {
  ok: { color: '#21883f', background: '#edf7f0' },
  waiting: { color: '#946617', background: '#fff7e6' },
  blocked: { color: '#bf4e46', background: '#fff0ee' },
};
export const stepTones = {
  login: healthTones.ok,
  computer: { color: '#358bd5', background: '#edf5fe' },
  path: { color: '#7960db', background: '#f0ecfc' },
  chat: { color: '#d38132', background: '#fff2e8' },
};

export const healthStyles = StyleSheet.create({
  content: { paddingBottom: 24, gap: 12, width: '100%', maxWidth: 400, alignSelf: 'center' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 16 },
  summaryIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  summaryTitle: { fontSize: 16, lineHeight: 24, fontWeight: '700' },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  steps: { gap: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 68,
    borderWidth: 1, borderColor: '#eeeeef', borderRadius: 14, backgroundColor: '#fff' },
  stepIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  label: { color: palette.ink, fontSize: 14, lineHeight: 22, fontWeight: '600' },
  detail: { color: '#777f84', fontSize: 12, lineHeight: 19, flexShrink: 1 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 6,
    borderRadius: 12, flexShrink: 1, maxWidth: '32%' },
  badgeIcon: { width: 13, height: 13, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  wideBadge: { maxWidth: '100%', alignSelf: 'flex-start', marginTop: 2 },
  badgeLabel: { fontSize: 12, lineHeight: 18, fontWeight: '600', flexShrink: 1 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16,
    marginTop: 12, borderRadius: 16, backgroundColor: '#f4f6fd' },
  button: { flexDirection: 'row', gap: 8, padding: 12, minHeight: 44,
    backgroundColor: palette.green, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#fff', fontSize: 14, lineHeight: 22, fontWeight: '600' },
  pressed: { opacity: 0.78 },
});

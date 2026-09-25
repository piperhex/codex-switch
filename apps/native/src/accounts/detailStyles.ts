import { StyleSheet } from 'react-native';

export const detailColors = {
  ink: '#111827', muted: '#738091', border: '#e6ebef', green: '#00aa96', blue: '#409fff',
  mint: '#e0f8f3', panel: '#fcfdfd', danger: '#d95454', warning: '#cc9137',
};

export const detailStyles = StyleSheet.create({
  content: { paddingBottom: 20, gap: 12 },
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
    borderRadius: 14, backgroundColor: '#f0f8f8',
  },
  avatar: {
    width: 54, height: 54, borderRadius: 27, backgroundColor: '#d9f6f0',
    alignItems: 'center', justifyContent: 'center',
  },
  initials: { color: detailColors.green, fontSize: 22, fontWeight: '800' },
  identity: { flex: 1, minWidth: 0, gap: 5 },
  email: { color: detailColors.ink, fontSize: 16, fontWeight: '700' },
  status: { color: detailColors.muted, fontSize: 11, lineHeight: 17 },
  badge: { alignSelf: 'flex-start', borderRadius: 10, backgroundColor: detailColors.mint, paddingHorizontal: 10 },
  plan: { color: '#009b80', fontSize: 12, fontWeight: '700', lineHeight: 22 },
  refresh: { alignItems: 'center', gap: 4 },
  refreshCircle: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#bfede5',
    backgroundColor: '#e1f8f3', alignItems: 'center', justifyContent: 'center',
  },
  refreshCaption: { color: detailColors.muted, fontSize: 10 },
  section: {
    borderWidth: 1, borderColor: detailColors.border, borderRadius: 14,
    backgroundColor: detailColors.panel, padding: 12,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8 },
  sectionIcon: {
    width: 28, height: 28, borderRadius: 8, backgroundColor: '#edf1f4',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: detailColors.ink, fontSize: 15, fontWeight: '700', flex: 1 },
  iconButton: { minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  updated: { color: detailColors.muted, fontSize: 10, flexShrink: 1, textAlign: 'right', maxWidth: 148 },
  meter: { marginTop: 9, marginBottom: 8 },
  meterHeading: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  meterTitle: { color: detailColors.ink, fontSize: 13, fontWeight: '700' },
  remaining: { fontSize: 19, fontWeight: '700' },
  remainingUnit: { color: detailColors.muted, fontSize: 11 },
  spacer: { flex: 1 },
  track: { height: 8, borderRadius: 5, backgroundColor: '#eaf0f1', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5 },
  reset: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  resetText: { flex: 1, color: detailColors.muted, fontSize: 11, lineHeight: 17 },
  error: { color: detailColors.danger, fontSize: 12, lineHeight: 18, marginTop: 5 },
  row: {
    minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: detailColors.border, paddingVertical: 5,
  },
  label: { width: 78, color: detailColors.muted, fontSize: 12 },
  value: { flex: 1, color: detailColors.ink, fontSize: 12, lineHeight: 19 },
  emptyValue: { color: detailColors.muted },
  codeButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30 },
  emptyCode: { color: detailColors.muted, fontSize: 12 },
  code: { color: detailColors.green, fontWeight: '700', fontSize: 17, letterSpacing: 2 },
  countdown: { color: detailColors.muted, fontSize: 10 },
  note: { color: detailColors.ink, fontSize: 14, lineHeight: 23, maxWidth: 400 },
  messageContent: { paddingBottom: 20, alignSelf: 'center', width: '100%', maxWidth: 440 },
  switchButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    minHeight: 48, borderRadius: 12, backgroundColor: detailColors.mint, paddingHorizontal: 14,
  },
  switchText: { color: detailColors.green, fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});

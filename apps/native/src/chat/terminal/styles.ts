import { StyleSheet } from 'react-native';

export const terminalStyles = StyleSheet.create({
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: .4 },
  overlay: { flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' },
  backdrop: { flex: 1 },
  drawer: { height: '90%', backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18,
    overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 6,
    borderBottomWidth: 1, borderBottomColor: '#dfe5df' },
  heading: { flex: 1, minWidth: 0, paddingLeft: 6 },
  title: { color: '#17211b', fontSize: 16, fontWeight: '600' },
  subtitle: { color: '#718078', fontSize: 11, marginTop: 4 },
  screen: { flex: 1, backgroundColor: '#fff' },
  loading: { flex: 1 },
  status: { maxWidth: 400, alignSelf: 'center', fontSize: 12, color: '#718078', padding: 10 },
});

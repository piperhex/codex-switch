import { StyleSheet } from 'react-native';

export const scrollPadStyles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, zIndex: 3 },
  dismiss: { ...StyleSheet.absoluteFillObject },
  pad: { position: 'absolute' },
  cross: { position: 'absolute', backgroundColor: '#6a6f77', borderWidth: 2, borderColor: '#edf2f7', borderRadius: 14 },
  vertical: { left: '33.333%', top: 0, width: '33.333%', height: '100%' },
  horizontal: { left: 0, top: '33.333%', width: '100%', height: '33.333%' },
  center: { position: 'absolute', left: '33.333%', top: '33.333%', width: '33.333%', height: '33.333%',
    backgroundColor: '#6a6f77' },
  arrow: { position: 'absolute', width: 20, height: 20 },
  knob: { position: 'absolute', borderWidth: 4, borderColor: '#fff', borderRadius: 100, backgroundColor: '#8bb8ff' },
  hint: { position: 'absolute', bottom: 8, alignSelf: 'center', maxWidth: 400, marginHorizontal: 8,
    borderRadius: 8, padding: 10, backgroundColor: '#202634ed' },
  hintText: { color: '#e7edf8', fontSize: 13 },
});

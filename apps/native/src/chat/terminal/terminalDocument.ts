import { Asset } from 'expo-asset';
import { readAsStringAsync } from 'expo-file-system';

/** The emulator and shortcuts are bundled with the app, including when the phone is offline. */
export async function terminalDocument() {
  const asset = Asset.fromModule(require('../../../assets/terminal.html'));
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('Terminal asset unavailable');
  return readAsStringAsync(asset.localUri);
}

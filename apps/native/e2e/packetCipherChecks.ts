import { getRandomBytes } from 'expo-crypto';
import { keyPair, SessionCipher } from '../../../shared/remote-chat/cipher';
import { createNativePacketCipher } from '../src/chat/packetCipher';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function rejects(action: () => unknown) {
  try { action(); } catch { return; }
  throw new Error('Expected packet rejection');
}

/** Run inside a release/Hermes APK so both Android crypto and the real synchronous bridge are exercised. */
export async function checkAndroidPacketCipher() {
  const desktopKeys = keyPair(getRandomBytes);
  const mobileKeys = keyPair(getRandomBytes);
  const desktop = new SessionCipher({ secret: desktopKeys.secret, publicKey: mobileKeys.publicKey,
    sessionId: 'android-interop', desktop: true });
  const mobileOptions = { secret: mobileKeys.secret, publicKey: desktopKeys.publicKey, desktop: false,
    createPacketCipher: createNativePacketCipher };
  const mobile = new SessionCipher({ ...mobileOptions, sessionId: 'android-interop' });
  const other = new SessionCipher({ ...mobileOptions, sessionId: 'android-other-session' });
  try {
    for (const text of ['', 'ascii', '中文😀\u0000 café', 'x'.repeat(16000)]) {
      const decoded = mobile.decrypt(desktop.encrypt(text));
      assert(decoded === text, `Android decode interoperability: ${JSON.stringify({ text, decoded })}`);
      const encoded = desktop.decrypt(mobile.encrypt(text));
      assert(encoded === text, `Android encode interoperability: ${JSON.stringify({ text, encoded })}`);
    }
    const packets: string[] = [];
    for (let index = 0; index < 1100; index++) {
      packets.push(desktop.encrypt('authenticated'));
      if (index % 32 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const last = packets[1099];
    rejects(() => mobile.decrypt(last.slice(0, -2) + (last.endsWith('00') ? '01' : '00')));
    rejects(() => other.decrypt(last));
    rejects(() => mobile.decrypt(mobile.encrypt('reflection')));
    rejects(() => mobile.decrypt(last.slice(0, -1) + 'G'));
    assert(mobile.decrypt(packets[0]) === 'authenticated', 'Authentication must not advance replay state');
    assert(mobile.decrypt(last) === 'authenticated', 'Valid packet after tampering');
    assert(mobile.decrypt(packets[0]) === null, 'Old packet rejection');
    assert(mobile.decrypt(packets[1098]) === 'authenticated', 'Out-of-order packet');
    assert(mobile.decrypt(last) === null, 'Replay rejection');
    mobile.destroy();
    rejects(() => mobile.encrypt('closed'));
    rejects(() => mobile.decrypt(last));
    return 'Android/Noble interoperability, tampering, session isolation, replay and disposal passed';
  } finally {
    desktop.destroy(); mobile.destroy(); other.destroy(); desktopKeys.secret.fill(0); mobileKeys.secret.fill(0);
  }
}

import { registerRootComponent } from 'expo';
import { getRandomBytes } from 'expo-crypto';
import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { keyPair, SessionCipher } from '../../../shared/remote-chat/cipher';
import type { PacketCipherFactory } from '../../../shared/remote-chat/packetCipher';
import { createNativePacketCipher } from '../src/chat/packetCipher';
import { checkAndroidPacketCipher } from './packetCipherChecks';

const MIB = 1024 * 1024;
const PACKETS = 512;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function benchmark(length: number, createPacketCipher?: PacketCipherFactory) {
  const sender = keyPair(getRandomBytes);
  const receiver = keyPair(getRandomBytes);
  const encode = new SessionCipher({ secret: sender.secret, publicKey: receiver.publicKey,
    sessionId: 'isolated-packet-benchmark', desktop: true, createPacketCipher });
  const decode = new SessionCipher({ secret: receiver.secret, publicKey: sender.publicKey,
    sessionId: 'isolated-packet-benchmark', desktop: false, createPacketCipher });
  const source = 'a'.repeat(length);
  let encodeMs = 0;
  let decodeMs = 0;
  let maxCallMs = 0;
  try {
    for (let index = 0; index < PACKETS; index++) {
      const start = performance.now();
      const packet = encode.encrypt(source);
      const middle = performance.now();
      if (decode.decrypt(packet) !== source) throw new Error('Cipher roundtrip failed');
      const end = performance.now();
      encodeMs += middle - start;
      decodeMs += end - middle;
      maxCallMs = Math.max(maxCallMs, middle - start, end - middle);
      if (index % 8 === 0) await pause();
    }
    return { length, native: Boolean(createPacketCipher), maxCallMs,
      encryptMiBs: PACKETS * length / MIB / (encodeMs / 1000),
      decryptMiBs: PACKETS * length / MIB / (decodeMs / 1000) };
  } finally {
    encode.destroy(); decode.destroy(); sender.secret.fill(0); receiver.secret.fill(0);
  }
}

async function run() {
  const native = createNativePacketCipher({ key: new Uint8Array(32), context: new Uint8Array(1) });
  if (!native) throw new Error('Native cipher unavailable');
  native.destroy();
  return { checks: await checkAndroidPacketCipher(), cipher: [
    await benchmark(2400), await benchmark(2400, createNativePacketCipher),
    await benchmark(16000, createNativePacketCipher),
  ] };
}

function App() {
  const [report, setReport] = useState('正在检查加密兼容性并测速…');
  useEffect(() => {
    void run().then((result) => {
      console.log('TRANSFER_BENCHMARK', JSON.stringify(result));
      setReport(JSON.stringify(result, null, 2));
    }).catch((error: unknown) => {
      console.error('TRANSFER_BENCHMARK_ERROR', String(error));
      setReport(String(error));
    });
  }, []);
  return <ScrollView style={{ padding: 30, paddingTop: 80 }}><Text selectable>{report}</Text></ScrollView>;
}

registerRootComponent(App);

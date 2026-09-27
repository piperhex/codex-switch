import { registerRootComponent } from 'expo';
import { getRandomBytes } from 'expo-crypto';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import TcpSocket from 'react-native-tcp-socket';
import { Buffer } from 'buffer';
import { NativeTcpNetwork } from '../src/chat/tcpNetwork';
import { TcpPeer } from '../../../shared/remote-chat/tcp/peer';
import type { TcpSignal } from '../../../shared/remote-chat/tcp/types';
import type { Channel } from '../../../shared/remote-chat/protocol';

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function wait(check: () => boolean) {
  for (let count = 0; count < 100; count++) { if (check()) return; await pause(100); }
  throw new Error('TCP fixture timed out');
}

async function run() {
  const clients = new Set<InstanceType<typeof TcpSocket.Socket>>();
  const server = TcpSocket.createServer(socket => {
    clients.add(socket); socket.on('error', () => socket.destroy());
    let request = Buffer.alloc(0);
    socket.on('data', bytes => {
      request = Buffer.concat([request, typeof bytes === 'string' ? Buffer.from(bytes) : bytes]);
      if (request.length !== 20) return;
      const response = Buffer.alloc(32); request.copy(response);
      response.writeUInt16BE(0x101, 0); response.writeUInt16BE(12, 2);
      response.writeUInt16BE(0x20, 20); response.writeUInt16BE(8, 22); response[25] = 1;
      response.writeUInt16BE(socket.remotePort! ^ 0x2112, 26);
      socket.remoteAddress!.split('.').map(Number).forEach((byte, index) => {
        response[28 + index] = byte ^ request[4 + index];
      });
      socket.write(response);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.on('error', reject); server.listen({ host: '0.0.0.0', port: 0 }, resolve);
  });
  const peers: TcpPeer[] = [], channels: Channel[][] = [[], []], signals: TcpSignal[][] = [[], []];
  try {
    for (const side of [0, 1]) peers.push(new TcpPeer({ sessionId: 'android-punch-fixture', desktop: side === 0,
      config: { servers: [{ host: process.env.EXPO_PUBLIC_TCP_TEST_HOST ?? '10.0.2.15', port: server.address()!.port }] },
      random: getRandomBytes, signal: signal => { signals[side].push(signal); peers[1 - side]?.accept(signal); },
      channel: channel => channels[side].push(channel) }, new NativeTcpNetwork()));
    signals[0].forEach(signal => peers[1].accept(signal));
    await wait(() => channels.every(paths => paths.some(path => path.readyState === 'open')));
    let received = '', echoed = '';
    channels[1].forEach(channel => channel.onMessage(text => { received = text; channel.send('ack'); }));
    channels[0].forEach(channel => channel.onMessage(text => { echoed = text; }));
    const payload = '跨设备 TCP 验证 '.repeat(2000);
    channels[0].find(channel => channel.readyState === 'open')!.send(payload);
    await wait(() => received === payload && echoed === 'ack');
    return { passed: true, characters: received.length, channels: channels.map(paths => paths.length) };
  } finally { peers.forEach(peer => peer.close()); clients.forEach(socket => socket.destroy()); server.close(); }
}

function App() {
  const [status, setStatus] = useState('正在检查直连…');
  useEffect(() => {
    void run().then(result => {
      console.log('TCP_PUNCH_RESULT', JSON.stringify(result)); setStatus('直连检查通过');
    }).catch((error: unknown) => {
      console.error('TCP_PUNCH_ERROR', String(error)); setStatus(String(error));
    });
  }, []);
  return <Text style={{ padding: 40 }}>{status}</Text>;
}
registerRootComponent(App);

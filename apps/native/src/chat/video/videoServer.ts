import { t } from '../../i18n';
import TcpSocket from 'react-native-tcp-socket';
type Socket = InstanceType<typeof TcpSocket.Socket>;
import type { RangeSource } from './videoRangeStream';
import { serveVideoSocket } from './videoSocket';

const LOOPBACK = '127.0.0.1';
const MAX_CONNECTIONS = 4;
const START_TIMEOUT_MS = 10_000;
export interface VideoServer { url: string; close: () => void }

/** Only the app's player can access this loopback endpoint with its random session capability. */
export function createVideoServer(source: RangeSource, onError: (error: unknown) => void): Promise<VideoServer> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<Socket>();
    let started = false;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timeout);
      for (const socket of sockets) socket.destroy();
      server.close();
    };
    const server = TcpSocket.createServer((socket) => {
      if (closed || sockets.size >= MAX_CONNECTIONS) { socket.destroy(); return; }
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      serveVideoSocket(socket, source, onError);
    });
    const fail = (error: unknown) => {
      close();
      if (started) onError(error); else reject(error);
    };
    const timeout = setTimeout(() => fail(new Error(t("视频播放器启动超时，请重试。"))), START_TIMEOUT_MS);
    server.on('error', fail);
    server.listen({ host: LOOPBACK, port: 0 }, () => {
      if (closed) { server.close(); return; }
      clearTimeout(timeout);
      const address = server.address();
      if (!address) { fail(new Error(t("视频播放器启动失败，请重试。"))); return; }
      started = true;
      resolve({ url: `http://${LOOPBACK}:${address.port}/${source.info.id}`, close });
    });
  });
}

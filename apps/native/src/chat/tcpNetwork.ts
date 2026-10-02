import TcpSocket from 'react-native-tcp-socket';
import { Buffer } from 'buffer';
import { localChatAddresses } from './nativePath';
import type { TcpAddress, TcpNetwork, TcpSocket as SocketPort } from '../../../../shared/remote-chat/tcp/types';

type Socket = InstanceType<typeof TcpSocket.Socket>;
const CONNECT_TIMEOUT_MS = 8000;
const MAX_BUFFER_BYTES = 512 * 1024;
const MAX_SOCKETS = 16;

function port(socket: Socket): SocketPort {
  let receive: ((data: Uint8Array) => void) | undefined;
  let closed = false;
  let buffered = 0;
  let writing = 0;
  const queued: Uint8Array[] = [], callbacks = new Set<() => void>();
  socket.setNoDelay(true);
  socket.on('error', () => socket.destroy());
  socket.on('close', () => { closed = true; queued.length = 0; callbacks.forEach(callback => callback()); });
  socket.on('data', value => {
    const bytes = typeof value === 'string' ? Buffer.from(value) : value;
    if (receive) { receive(bytes); return; }
    buffered += bytes.length;
    if (buffered > MAX_BUFFER_BYTES) { socket.destroy(); return; }
    queued.push(bytes);
  });
  return {
    get localAddress() { return socket.localAddress ?? ''; },
    get localPort() { return socket.localPort ?? 0; },
    get remoteAddress() { return socket.remoteAddress; },
    get remotePort() { return socket.remotePort; },
    get bufferedAmount() { return writing; },
    write: data => {
      if (closed || writing + data.length > MAX_BUFFER_BYTES) throw new Error('TCP path busy');
      writing += data.length;
      socket.write(Buffer.from(data), undefined, error => {
        writing -= data.length;
        if (error) socket.destroy();
      });
    },
    close: () => socket.destroy(),
    onData: callback => { receive = callback; buffered = 0; queued.splice(0).forEach(data => callback(data)); },
    onClose: callback => { callbacks.add(callback); if (closed) callback(); },
  };
}

/** Native TCP sockets share a local port across discovery, listening and simultaneous outbound dialing. */
export class NativeTcpNetwork implements TcpNetwork {
  localAddresses() { return localChatAddresses(); }
  private stopped = false;
  private readonly sockets = new Set<Socket>();
  private readonly servers = new Set<InstanceType<typeof TcpSocket.Server>>();

  private own(socket: Socket) {
    if (this.stopped || this.sockets.size >= MAX_SOCKETS) { socket.destroy(); throw new Error('TCP path unavailable'); }
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    return port(socket);
  }

  listen(ipv6: boolean, accept: (socket: SocketPort) => void): Promise<{ port: number; close: () => void }> {
    return new Promise((resolve, reject) => {
      const server = TcpSocket.createServer(socket => {
        try { accept(this.own(socket)); } catch { socket.destroy(); }
      });
      this.servers.add(server);
      let canceled = false;
      const close = () => {
        canceled = true;
        if (server.address()) server.close();
        this.servers.delete(server);
      };
      const timer = setTimeout(() => { close(); reject(new Error('TCP listener unavailable')); }, CONNECT_TIMEOUT_MS);
      server.on('error', error => { clearTimeout(timer); close(); reject(error); });
      // reusePort is supplied by our version-pinned Android patch, before the socket is bound.
      const options = { host: ipv6 ? '::' : '0.0.0.0', port: 0, reuseAddress: true, reusePort: true };
      server.listen(options, () => {
        clearTimeout(timer);
        const address = server.address();
        if (!address || this.stopped || canceled) { close(); reject(new Error('TCP listener stopped')); return; }
        resolve({ port: address.port, close });
      });
    });
  }

  connect(address: TcpAddress & { localPort: number; ipv6: boolean }): Promise<SocketPort> {
    return new Promise((resolve, reject) => {
      if (this.stopped || this.sockets.size >= MAX_SOCKETS) { reject(new Error('TCP path stopped')); return; }
      const options = { host: address.host, port: address.port,
        localPort: address.localPort, localAddress: address.ipv6 ? '::' : '0.0.0.0',
        reuseAddress: true, reusePort: true, connectTimeout: CONNECT_TIMEOUT_MS };
      const socket = TcpSocket.createConnection(options, () => undefined);
      const stream = this.own(socket);
      socket.once('connect', () => resolve(stream));
      socket.once('error', reject);
      socket.once('close', () => reject(new Error('TCP path closed')));
    });
  }

  close() {
    this.stopped = true;
    this.servers.forEach(server => { if (server.listening) server.close(); });
    this.servers.clear();
    this.sockets.forEach(socket => socket.destroy());
    this.sockets.clear();
  }
}

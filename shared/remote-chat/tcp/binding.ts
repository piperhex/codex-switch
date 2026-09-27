import type { TcpAddress, TcpSocket } from './types';

const COOKIE = 0x2112a442;
const TIMEOUT_MS = 5000;

/** RFC 5389 Binding over TCP, using the same local port as the subsequent peer connection. */
export function discover(socket: TcpSocket, random: (length: number) => Uint8Array): Promise<TcpAddress> {
  const request = new Uint8Array(20);
  const header = new DataView(request.buffer);
  header.setUint16(0, 1);
  header.setUint32(4, COOKIE);
  request.set(random(12), 8);
  return new Promise((resolve, reject) => {
    let buffer = new Uint8Array(0);
    let settled = false;
    const finish = (address?: TcpAddress) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (address) resolve(address);
      else { socket.close(); reject(new Error('TCP discovery unavailable')); }
    };
    const timer = setTimeout(() => finish(), TIMEOUT_MS);
    socket.onClose(() => finish());
    socket.onData(data => {
      if (settled) return;
      if (buffer.length + data.length > 1200) { finish(); return; }
      buffer = Uint8Array.from([...buffer, ...data]);
      if (buffer.length < 20) return;
      const length = new DataView(buffer.buffer).getUint16(2) + 20;
      if (buffer.length >= length) finish(bindingAddress(buffer, request));
    });
    try { socket.write(request); } catch { finish(); }
  });
}

export function bindingAddress(response: Uint8Array, request: Uint8Array): TcpAddress | undefined {
  if (response.length < 20 || request.length !== 20) return;
  const view = new DataView(response.buffer, response.byteOffset, response.byteLength);
  if (view.getUint16(0) !== 0x101 || view.getUint32(4) !== COOKIE
    || request.subarray(8).some((byte, index) => response[8 + index] !== byte)) return;
  const end = view.getUint16(2) + 20;
  if (end > response.length) return;
  for (let offset = 20; offset + 4 <= end;) {
    const kind = view.getUint16(offset), size = view.getUint16(offset + 2);
    if (offset + 4 + size > end) return;
    if (kind === 0x20 && (size === 8 || size === 20)) {
      const family = response[offset + 5];
      if ((family !== 1 || size !== 8) && (family !== 2 || size !== 20)) return;
      const ip = response.slice(offset + 8, offset + 4 + size);
      for (let index = 0; index < ip.length; index++) ip[index] ^= request[4 + index];
      const host = family === 1 ? Array.from(ip).join('.') : Array.from({ length: 8 }, (_, index) => (
        (ip[index * 2] * 256 + ip[index * 2 + 1]).toString(16))).join(':');
      return { host, port: view.getUint16(offset + 6) ^ (COOKIE >>> 16) };
    }
    offset += 4 + Math.ceil(size / 4) * 4;
  }
}

import { hmac } from '@noble/hashes/hmac';
import { hkdf } from '@noble/hashes/hkdf';
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { decodeChatUtf8 } from '../utf8';
import type { Channel } from '../protocol';
import type { TcpSocket } from './types';

const MAX_PACKET_BYTES = 128 * 1024;
const HANDSHAKE_TIMEOUT_MS = 5000;

/** A TCP socket becomes a path only after both peers prove possession of the signaled ephemeral key. */
export class TcpChannel implements Channel {
  private state = 'connecting';
  private buffer = new Uint8Array(0);
  private readonly nonce: string;
  private remoteNonce?: string;
  private dataKey?: Uint8Array;
  private sent = 0;
  private received = 0;
  private readonly opened = new Set<() => void>();
  private readonly closed = new Set<() => void>();
  private readonly messages = new Set<(text: string) => void>();
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(private readonly options: {
    socket: TcpSocket; key: Uint8Array; desktop: boolean; sessionId: string;
    random: (length: number) => Uint8Array;
  }) {
    this.nonce = bytesToHex(options.random(32));
    this.timer = setTimeout(() => this.close(), HANDSHAKE_TIMEOUT_MS);
    options.socket.onClose(() => this.close());
    this.write(`hello:${this.nonce}`);
    options.socket.onData(data => this.receive(data));
  }

  get readyState() { return this.state; }
  get bufferedAmount() { return this.options.socket.bufferedAmount; }
  onOpen(callback: () => void) { this.opened.add(callback); }
  onClose(callback: () => void) { if (this.state === 'closed') callback(); else this.closed.add(callback); }
  onMessage(callback: (text: string) => void) { this.messages.add(callback); }

  send(text: string) {
    if (this.state !== 'open') throw new Error('TCP path unavailable');
    // A failed write has already consumed its AEAD sequence; never reuse this stream afterward.
    try { this.write(text); } catch (error) { this.close(); throw error; }
  }

  private write(text: string) {
    const plain = utf8ToBytes(text);
    const bytes = this.state === 'open' ? this.encrypt(plain) : plain;
    if (bytes.length > MAX_PACKET_BYTES) throw new Error('TCP packet too large');
    const frame = new Uint8Array(bytes.length + 4);
    new DataView(frame.buffer).setUint32(0, bytes.length);
    frame.set(bytes, 4);
    this.options.socket.write(frame);
  }

  private receive(data: Uint8Array) {
    if (this.state === 'closed') return;
    try {
      // Bound incomplete input; process coalesced TCP frames individually.
      let offset = 0;
      while (offset < data.length) {
        const take = Math.min(data.length - offset, MAX_PACKET_BYTES + 4 - this.buffer.length);
        const joined = new Uint8Array(this.buffer.length + take);
        joined.set(this.buffer);
        joined.set(data.subarray(offset, offset + take), this.buffer.length);
        this.buffer = joined;
        offset += take;
        this.drain();
        if (!take) throw new Error('Invalid TCP framing');
      }
    } catch { this.close(); }
  }

  private drain() {
    while (this.buffer.length >= 4) {
      const size = new DataView(this.buffer.buffer).getUint32(0);
      if (!size || size > MAX_PACKET_BYTES || (this.state !== 'open' && size > 256)) {
        throw new Error('Invalid TCP frame');
      }
      if (this.buffer.length < size + 4) return;
      const packet = this.buffer.subarray(4, size + 4);
      const text = decodeChatUtf8(this.state === 'open' ? this.decrypt(packet) : packet);
      this.buffer = this.buffer.slice(size + 4);
      if (this.state === 'open') this.messages.forEach(callback => callback(text));
      else this.authenticate(text);
    }
  }

  private proof(desktop: boolean) {
    const context = JSON.stringify(['codex-tcp-v1', this.options.sessionId, desktop, ...this.nonces()]);
    return hmac(sha256, this.options.key, utf8ToBytes(context));
  }

  private nonces() {
    return this.options.desktop ? [this.nonce, this.remoteNonce] : [this.remoteNonce, this.nonce];
  }

  private packetNonce(sequence: number, sending: boolean) {
    const nonce = new Uint8Array(12), view = new DataView(nonce.buffer);
    view.setUint32(0, this.options.desktop === sending ? 1 : 2);
    view.setUint32(8, sequence);
    return nonce;
  }

  private encrypt(plain: Uint8Array) {
    if (!this.dataKey || ++this.sent > 0xffffffff) throw new Error('TCP sequence exhausted');
    return chacha20poly1305(this.dataKey, this.packetNonce(this.sent, true)).encrypt(plain);
  }

  private decrypt(packet: Uint8Array) {
    if (!this.dataKey || ++this.received > 0xffffffff) throw new Error('TCP sequence exhausted');
    return chacha20poly1305(this.dataKey, this.packetNonce(this.received, false)).decrypt(packet);
  }

  private authenticate(text: string) {
    if (!this.remoteNonce) {
      if (!/^hello:[a-f0-9]{64}$/.test(text)) throw new Error('Invalid TCP greeting');
      this.remoteNonce = text.slice(6);
      this.write(`proof:${bytesToHex(this.proof(this.options.desktop))}`);
      return;
    }
    if (!/^proof:[a-f0-9]{64}$/.test(text)) throw new Error('Invalid TCP proof');
    const expected = this.proof(!this.options.desktop), actual = hexToBytes(text.slice(6));
    let mismatch = 0;
    expected.forEach((byte, index) => { mismatch |= byte ^ actual[index]; });
    if (mismatch) throw new Error('TCP authentication failed');
    // Each socket has its own nonce-derived key; simultaneous TCP connections must never reuse AEAD nonces.
    this.dataKey = hkdf(sha256, this.options.key, utf8ToBytes(JSON.stringify(this.nonces())),
      utf8ToBytes(`codex-tcp-data-v1:${this.options.sessionId}`), 32);
    this.state = 'open';
    clearTimeout(this.timer);
    this.opened.forEach(callback => callback());
  }

  close() {
    if (this.state === 'closed') return;
    this.state = 'closed';
    clearTimeout(this.timer);
    this.options.socket.close();
    this.buffer = new Uint8Array(0);
    this.closed.forEach(callback => callback());
    this.closed.clear(); this.opened.clear(); this.messages.clear();
    this.options.key.fill(0);
    this.dataKey?.fill(0);
  }
}

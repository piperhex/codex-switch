import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createSocket, type Socket } from 'dgram';
import { isIPv4 } from 'net';

const STUN_COOKIE = 0x2112a442;
const BINDING_REQUEST = 0x0001;
const BINDING_SUCCESS = 0x0101;
const XOR_MAPPED_ADDRESS = 0x0020;
const HEADER_BYTES = 20;
const MAX_STUN_PACKET = 1200;

/** RFC 8489 binding discovery; chat relay traffic uses the authenticated WebSocket gateway. */
export function bindingResponse(request: Buffer, address: string, port: number): Buffer | null {
  if (request.length < HEADER_BYTES || request.length > MAX_STUN_PACKET || !isIPv4(address)
    || request.readUInt16BE(0) !== BINDING_REQUEST || request.readUInt32BE(4) !== STUN_COOKIE
    || request.readUInt16BE(2) % 4 !== 0 || request.readUInt16BE(2) !== request.length - HEADER_BYTES) return null;
  const response = Buffer.alloc(32);
  response.writeUInt16BE(BINDING_SUCCESS, 0);
  response.writeUInt16BE(12, 2);
  response.writeUInt32BE(STUN_COOKIE, 4);
  request.copy(response, 8, 8, 20);
  response.writeUInt16BE(XOR_MAPPED_ADDRESS, 20);
  response.writeUInt16BE(8, 22);
  response[25] = 1;
  response.writeUInt16BE(port ^ (STUN_COOKIE >>> 16), 26);
  const octets = address.split('.').map(Number);
  for (let index = 0; index < 4; index += 1) response[28 + index] = octets[index] ^ response[4 + index];
  return response;
}

@Injectable()
export class ChatStunService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatStunService.name);
  private socket?: Socket;
  private windowStart = 0;
  private packets = 0;

  iceServers(): { urls: string[] }[] {
    const urls = (process.env.CHAT_STUN_URLS ?? '').split(',').map((url) => url.trim()).filter(Boolean);
    if (urls.some((url) => !/^stuns?:[^\s/?#@]+(?::\d+)?$/.test(url))) throw new Error('Invalid CHAT_STUN_URLS');
    return urls.length ? [{ urls }] : [];
  }

  onModuleInit() {
    this.iceServers();
    const port = Number(process.env.CHAT_STUN_PORT ?? 3478);
    if (port === 0) return;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid CHAT_STUN_PORT');
    const socket = createSocket('udp4');
    this.socket = socket;
    socket.on('error', (error) => this.logger.error(`Chat STUN unavailable: ${error.message}`));
    socket.on('message', (packet, remote) => {
      if (Date.now() - this.windowStart >= 1000) { this.windowStart = Date.now(); this.packets = 0; }
      // Bound work and reflected traffic even when an unauthenticated sender floods discovery.
      this.packets += 1;
      if (this.packets > 1000) return;
      const response = bindingResponse(packet, remote.address, remote.port);
      if (response) socket.send(response, remote.port, remote.address, (error) => {
        if (error) this.logger.debug('Chat STUN response could not be sent');
      });
    });
    socket.bind(port, process.env.CHAT_STUN_BIND ?? '0.0.0.0');
  }

  onModuleDestroy() {
    if (!this.socket) return;
    try { this.socket.close(); } catch { /* A bind failure can leave the socket already closed. */ }
    this.socket = undefined;
  }
}

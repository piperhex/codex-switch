import type { ConnectionMode, IceServer, PeerFactory, RpcMessage } from './protocol';
import type { PacketCipherFactory } from './packetCipher';

export interface LinkOptions {
  sessionId: string;
  desktop: boolean;
  secret: Uint8Array;
  publicKey?: string;
  iceServers: IceServer[];
  createPeer: PeerFactory;
  createPacketCipher?: PacketCipherFactory;
  signal: (message: object) => void;
  relayBuffered: () => number;
  message: (message: RpcMessage) => void;
  mode: (mode: ConnectionMode) => void;
  error: (message: string) => void;
  transportVersion?: number;
  reconnectRelay?: () => void;
}

import { getRandomBytes } from 'expo-crypto';
import { RTCPeerConnection as NativePeerConnection } from 'react-native-webrtc';
import { fetchUserProfile } from '../api/client';
import type { AuthSession } from '../types';
import { ChatConnection, type ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { RtcPeer } from '../../../../shared/remote-chat/rtcPeer';

interface Options extends ConnectionEvents { session: AuthSession; deviceId: string }

export class MobileChatConnection extends ChatConnection {
  constructor({ session, ...options }: Options) {
    super({ ...options, randomBytes: getRandomBytes,
      authorize: async () => { await fetchUserProfile(session); return session; },
      // Native WebRTC implements the browser subset, but ships independent TypeScript declarations.
      createPeer: (peer) => new RtcPeer(peer, () => (
        new NativePeerConnection({ iceServers: peer.iceServers }) as unknown as RTCPeerConnection)),
    });
  }
}

import { getRandomBytes } from 'expo-crypto';
import { Platform } from 'react-native';
import { RTCPeerConnection as NativePeerConnection } from 'react-native-webrtc';
import { fetchUserProfile } from '../api/client';
import type { AuthSession } from '../types';
import { ChatConnection, type ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { RtcPeer } from '../../../../shared/remote-chat/rtcPeer';
import { createNativePacketCipher } from './packetCipher';

interface Options extends ConnectionEvents { session: AuthSession; deviceId: string }

export class MobileChatConnection extends ChatConnection {
  constructor({ session, ...options }: Options) {
    super({ ...options, randomBytes: getRandomBytes,
      createPacketCipher: createNativePacketCipher,
      clientInfo: { name: Platform.OS === 'android' ? Platform.constants.Model : 'iPhone / iPad',
        platform: Platform.OS === 'android' ? 'Android' : 'iOS' },
      authorize: async () => { await fetchUserProfile(session); return session; },
      // Native WebRTC implements the browser subset, but ships independent TypeScript declarations.
      createPeer: (peer) => new RtcPeer(peer, () => (
        new NativePeerConnection({ iceServers: peer.iceServers }) as unknown as RTCPeerConnection)),
    });
  }
}

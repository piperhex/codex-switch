import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import type { Signal } from './protocol';

export interface TrustStore { read(key: string): Promise<string | null>; save(key: string, value: string): Promise<void> }
export class HostIdentityError extends Error {}
export const HOST_IDENTITY_CHANGED = '电脑身份已变化，请先核对电脑上的设备指纹。';
export type HostKeyVerifier = ((sessionId: string, signal: Extract<Signal, { kind: 'key' }>) => Promise<void>)
  & { confirm?: (fingerprint: string) => Promise<void> };
export function trustScope(server: string, device: string) {
  return `chat-trust-${bytesToHex(sha256(utf8ToBytes(`${server.replace(/\/+$/, '')}:${device}`)))}`;
}

/** First use pins the host key. Subsequent key changes and unsigned downgrades fail closed. */
export function trustedHost(store: TrustStore, scope: string) {
  let changedKey: string | undefined;
  const verify = async (sessionId: string, signal: Extract<Signal, { kind: 'key' }>) => {
    const pinned = await store.read(scope);
    const identity = signal.identity;
    if (!identity) {
      if (pinned) throw new HostIdentityError('电脑身份未能验证，请更新电脑和服务器后重试。');
      return; // Old peers remain usable until a signed identity has been enrolled.
    }
    if (!/^[a-f0-9]{64}$/.test(identity.key) || !/^[a-f0-9]{128}$/.test(identity.signature)) {
      throw new HostIdentityError('电脑身份校验失败，连接已停止。');
    }
    const context = utf8ToBytes(`codex-switch-host-v1:${sessionId}:${signal.key}`);
    if (!ed25519.verify(hexToBytes(identity.signature), context, hexToBytes(identity.key))) {
      throw new HostIdentityError('电脑身份校验失败，连接已停止。');
    }
    if (pinned && pinned !== identity.key) {
      changedKey = identity.key;
      throw new HostIdentityError(HOST_IDENTITY_CHANGED);
    }
    if (!pinned) await store.save(scope, identity.key);
  };
  return Object.assign(verify, { confirm: async (fingerprint: string) => {
    const supplied = fingerprint.replace(/[\s:-]/g, '').toLowerCase();
    if (!changedKey || supplied !== changedKey) throw new Error('指纹不一致，请重新核对电脑上的设备指纹。');
    await store.save(scope, changedKey); changedKey = undefined;
  } });
}

export const browserTrustStore: TrustStore = {
  read: async key => localStorage.getItem(key),
  save: async (key, value) => localStorage.setItem(key, value),
};

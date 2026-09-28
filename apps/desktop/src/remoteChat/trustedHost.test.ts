import { expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { trustedHost } from '../../../../shared/remote-chat/trustedHost';
import type { Signal } from '../../../../shared/remote-chat/protocol';

function signed(seed = 7, session = 'session'): Extract<Signal, { kind: 'key' }> {
  const secret = new Uint8Array(32).fill(seed);
  const key = 'a'.repeat(64);
  return { kind: 'key', key, identity: { key: bytesToHex(ed25519.getPublicKey(secret)),
    signature: bytesToHex(ed25519.sign(utf8ToBytes(`codex-switch-host-v1:${session}:${key}`), secret)) } };
}

it('pins a signed host, blocks substitution and downgrade, and permits a manually matched new fingerprint', async () => {
  let stored: string | null = null;
  const verify = trustedHost({ read: async () => stored, save: async (_key, value) => { stored = value; } }, 'device');
  await verify('session', signed());
  expect(stored).toBe(signed().identity!.key);
  await expect(verify('different-session', signed())).rejects.toThrow('校验失败');
  await expect(verify('session', { kind: 'key', key: 'a'.repeat(64) })).rejects.toThrow('未能验证');
  await expect(verify('session', signed(8))).rejects.toThrow('身份已变化');
  await expect(verify.confirm(signed().identity!.key)).rejects.toThrow('指纹不一致');
  await verify.confirm(signed(8).identity!.key);
  await verify('session', signed(8));
});

it('does not silently ignore failures to save the initial trust record', async () => {
  const verify = trustedHost({ read: async () => null, save: async () => { throw new Error('storage denied'); } }, 'device');
  await expect(verify('session', signed())).rejects.toThrow('storage denied');
});

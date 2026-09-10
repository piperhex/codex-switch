import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyPair, SessionCipher } from '../../../../shared/remote-chat/cipher';
import { Assembler, chunks } from '../../../../shared/remote-chat/framing';
import { ChatLink } from '../../../../shared/remote-chat/link';
import { ChatRpc } from '../../../../shared/remote-chat/rpc';
import { chatSocketUrl, DIRECT_TIMEOUT_MS, RELAY_START_GRACE_MS,
  type Channel, type PeerOptions, type RpcMessage } from '../../../../shared/remote-chat/protocol';

function cipherPair(sessionId = 'test-session') {
  const phone = keyPair((size) => crypto.getRandomValues(new Uint8Array(size)));
  const pc = keyPair((size) => crypto.getRandomValues(new Uint8Array(size)));
  return {
    phone, pc,
    encrypt: new SessionCipher({ secret: phone.secret, publicKey: pc.publicKey, sessionId, desktop: false }),
    decrypt: new SessionCipher({ secret: pc.secret, publicKey: phone.publicKey, sessionId, desktop: true }),
  };
}

afterEach(() => vi.useRealTimers());

describe('encrypted chat transport', () => {
  it('preserves Unicode and rejects tampering, direction reflection, replay and other sessions', () => {
    const { phone, pc, encrypt, decrypt } = cipherPair();
    const packet = encrypt.encrypt('继续处理聊天 👩‍💻');
    expect(decrypt.decrypt(packet)).toBe('继续处理聊天 👩‍💻');
    expect(decrypt.decrypt(packet)).toBeNull();
    expect(() => encrypt.decrypt(packet)).toThrow();
    const other = new SessionCipher({ secret: pc.secret, publicKey: phone.publicKey, sessionId: 'other', desktop: true });
    expect(() => other.decrypt(packet)).toThrow();
    const fresh = encrypt.encrypt('secret');
    expect(() => decrypt.decrypt(`${fresh.slice(0, -2)}${fresh.endsWith('00') ? '01' : '00'}`)).toThrow();
  });

  it('assembles an encrypted history out of order without splitting emoji or accepting duplicate fragments', () => {
    const message: RpcMessage = { kind: 'event', event: { text: `${'a'.repeat(2348)}😀中文`.repeat(10) } };
    const frames = [...chunks(message, 'history')];
    const { encrypt, decrypt } = cipherPair();
    const assembler = new Assembler();
    const packets = frames.map((frame) => encrypt.encrypt(frame)).reverse();
    let result: RpcMessage | null = null;
    for (const packet of packets) {
      const plain = decrypt.decrypt(packet)!;
      result = assembler.accept(plain) ?? result;
      expect(decrypt.decrypt(packet)).toBeNull();
    }
    expect(result).toEqual(message);
  });

  it('bounds fragment count and partial assemblies', () => {
    const assembler = new Assembler();
    expect(() => assembler.accept(JSON.stringify({ id: 'x', total: 9999999, index: 0, text: '' }))).toThrow();
    for (let index = 0; index < 8; index++) {
      expect(assembler.accept(JSON.stringify({ id: String(index), total: 2, index: 0, text: 'x' }))).toBeNull();
    }
    expect(() => assembler.accept(JSON.stringify({ id: 'overflow', total: 2, index: 0, text: 'x' }))).toThrow();
  });

  it('preserves a server base path without putting credentials in the URL', () => {
    expect(chatSocketUrl('https://example.com/service/')).toBe('wss://example.com/service/device-chat');
    expect(() => chatSocketUrl('file:///private')).toThrow();
  });
});

function linkHarness() {
  const keys = cipherPair();
  let peerOptions: PeerOptions | undefined;
  const signal = vi.fn();
  const modes: string[] = [];
  const link = new ChatLink({ sessionId: 'test-session', desktop: true, secret: keys.pc.secret,
    publicKey: keys.phone.publicKey, iceServers: [],
    createPeer: (options) => {
      peerOptions = options;
      return { offer: async () => undefined, accept: async () => undefined, close: vi.fn() };
    }, signal, relayBuffered: () => 0, message: vi.fn(), mode: (mode) => modes.push(mode), error: vi.fn() });
  return { link, signal, modes, peer: () => peerOptions! };
}

describe('direct preference and relay fallback', () => {
  it('does not relay on an early ICE failure until the direct timeout expires', async () => {
    vi.useFakeTimers();
    const harness = linkHarness();
    harness.peer().disconnected();
    expect(harness.signal).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DIRECT_TIMEOUT_MS);
    harness.peer().disconnected();
    expect(harness.signal).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RELAY_START_GRACE_MS);
    expect(harness.signal).toHaveBeenCalledWith(expect.objectContaining({ type: 'relay-request', reason: 'timeout' }));
    harness.link.enableRelay();
    expect(harness.modes).toEqual(['relay']);
    harness.link.close();
  });

  it('cancels fallback after direct success and requests relay when that channel fails', async () => {
    vi.useFakeTimers();
    const harness = linkHarness();
    const channel: Channel = { readyState: 'open', bufferedAmount: 0, send: vi.fn(), close: vi.fn(),
      onOpen: vi.fn(), onClose: vi.fn(), onMessage: vi.fn() };
    harness.peer().channel(channel);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(harness.modes).toEqual(['direct']);
    expect(harness.signal).not.toHaveBeenCalled();
    harness.peer().disconnected();
    expect(harness.signal).toHaveBeenCalledWith(expect.objectContaining({ reason: 'disconnected' }));
    harness.link.enableRelay();
    expect(harness.modes).toEqual(['direct', 'connecting', 'relay']);
    harness.link.close();
  });

  it('keeps request ids through a path switch, resolves once, and rejects pending work on close', async () => {
    const sent: RpcMessage[] = [];
    const rpc = new ChatRpc({ prefix: 'phone', event: vi.fn(), send: async (message) => { sent.push(message); } });
    const request = rpc.request('request', { operation: 'send', text: 'test' });
    rpc.retry();
    expect(sent[0]).toEqual(sent[1]);
    const id = (sent[0] as { id: string }).id;
    rpc.receive({ kind: 'response', id, data: 'accepted' });
    expect(await request).toBe('accepted');
    const pending = rpc.request('connect');
    const rejected = expect(pending).rejects.toThrow('连接已中断');
    rpc.close();
    await rejected;
  });
});

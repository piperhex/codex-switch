import { expect, it, vi } from 'vitest';
import { encodeRelay, decodeRelay } from '../../../../shared/remote-chat/relayWire';
import { browserChatSocket } from '../../../../shared/remote-chat/client/socket';

it('uses the same binary envelope as Go and Rust and halves ciphertext bytes', () => {
  const frame = { type: 'relay', sessionId: 'session-1', payload: '00abff' };
  const wire = encodeRelay(JSON.stringify(frame)) as Uint8Array;
  expect([...wire]).toEqual([...new TextEncoder().encode('CSB1\x09session-1'), 0, 171, 255]);
  expect(JSON.parse(decodeRelay(wire.buffer as ArrayBuffer))).toEqual(frame);
  const large = encodeRelay(JSON.stringify({ ...frame, payload: 'ab'.repeat(10_000) })) as Uint8Array;
  expect(large.byteLength).toBe(10_000 + 5 + frame.sessionId.length);
});

it('rejects malformed or oversized envelopes', () => {
  for (const wire of ['', 'CSB1\xffx', 'CSB1\x00x', 'CSB1\x01/hello']) {
    expect(() => decodeRelay(new TextEncoder().encode(wire).buffer as ArrayBuffer)).toThrow();
  }
  for (const payload of ['a', 'xy', 'ab'.repeat(20_001)]) {
    expect(() => encodeRelay(JSON.stringify({ type: 'relay', sessionId: 'id', payload }))).toThrow();
  }
});

it('keeps old servers on text and enables binary only after the server confirms support', () => {
  const native = { send: vi.fn(), close: vi.fn(), onmessage: null as null | ((event: { data: unknown }) => void) };
  vi.stubGlobal('WebSocket', class { constructor() { return native; } });
  try {
    const socket = browserChatSocket('wss://example.test/device-chat');
    socket.onmessage = vi.fn();
    const data = JSON.stringify({ type: 'relay', sessionId: 'id', payload: 'ab'.repeat(28) });
    socket.send(data);
    expect(native.send).toHaveBeenLastCalledWith(data);
    native.onmessage!({ data: JSON.stringify({ type: 'chat-policy', policy: {} }) });
    socket.send(data);
    expect(native.send).toHaveBeenLastCalledWith(data);
    native.onmessage!({ data: JSON.stringify({ type: 'chat-policy', binaryRelay: true, policy: {} }) });
    socket.send(data);
    const encoded = native.send.mock.calls.at(-1)![0] as Uint8Array;
    expect(encoded).toBeInstanceOf(Uint8Array);
    native.onmessage!({ data: encoded.buffer });
    expect(socket.onmessage).toHaveBeenLastCalledWith({ data });
  } finally { vi.unstubAllGlobals(); }
});

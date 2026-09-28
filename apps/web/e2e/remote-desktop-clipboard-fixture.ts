import { CLIPBOARD_CHUNK_BYTES, decodeClipboardBytes, encodeClipboardBytes,
  type ClipboardContent, type ClipboardMessage, type ClipboardReply } from '../../../shared/remote-desktop/clipboard';

export const clipboardFixture = {
  content: { format: 'text', text: 'Remote clipboard 测试' } as ClipboardContent,
  requests: [] as ClipboardMessage[], pastes: 0, error: '',
};
let transfer = new Uint8Array();

/** Substitute OS clipboard access only; production control queues and WebRTC carry every request and reply. */
export function desktopClipboard(message: ClipboardMessage): ClipboardReply {
  clipboardFixture.requests.push(message);
  const reply: ClipboardReply = { kind: 'clipboard', requestId: message.requestId, result: {} };
  if (clipboardFixture.error) return { ...reply, error: clipboardFixture.error };
  const request = message.request;
  switch (request.action) {
    case 'read':
      transfer = new TextEncoder().encode(JSON.stringify(clipboardFixture.content));
      return { ...reply, result: { length: transfer.length } };
    case 'begin': transfer = new Uint8Array(request.length); return reply;
    case 'append': transfer.set(decodeClipboardBytes(request.data), request.offset); return reply;
    case 'chunk': return { ...reply, result: {
      data: encodeClipboardBytes(transfer.subarray(request.offset, request.offset + CLIPBOARD_CHUNK_BYTES)),
    } };
    case 'commit':
      clipboardFixture.content = JSON.parse(new TextDecoder().decode(transfer)) as ClipboardContent;
      if (request.paste) clipboardFixture.pastes += 1;
      return reply;
    case 'clear': transfer = new Uint8Array(); return reply;
  }
}

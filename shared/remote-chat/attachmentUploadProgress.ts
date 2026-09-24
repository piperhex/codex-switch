import { CHUNK_CHARS } from './framing';
import type { RpcMessage } from './protocol';
import type { TransferProgress, UploadItemProgress } from './uploadProgress';

interface UploadRange {
  kind: UploadItemProgress['kind'];
  index: number;
  start: number;
  end: number;
}

function uploadRanges(message: RpcMessage, text: string): UploadRange[] {
  if (message.kind !== 'request' || !message.body || typeof message.body !== 'object') return [];
  const body = message.body as { images?: unknown[]; attachments?: unknown[] };
  const ranges: UploadRange[] = [];
  let cursor = text.indexOf('"images":[');
  body.images?.forEach((image, index) => {
    if (typeof image !== 'string' || !image.startsWith('data:') || cursor < 0) return;
    const start = text.indexOf(JSON.stringify(image), cursor) + 1;
    if (start === 0) return;
    cursor = start + image.length;
    ranges.push({ kind: 'image', index, start, end: cursor });
  });
  cursor = text.indexOf('"attachments":[');
  body.attachments?.forEach((item, index) => {
    const data = item && typeof item === 'object' ? (item as { data?: unknown }).data : undefined;
    if (typeof data !== 'string' || !data || cursor < 0) return;
    const field = '"data":';
    const start = text.indexOf(`${field}${JSON.stringify(data)}`, cursor) + field.length + 1;
    if (start === field.length) return;
    cursor = start + data.length;
    ranges.push({ kind: 'attachment', index, start, end: cursor });
  });
  return ranges;
}

/** Measure each upload against the actual serialized chunks, without changing the wire protocol. */
export function attachmentUploadReporter(message: RpcMessage, text: string, report: TransferProgress): TransferProgress {
  const ranges = uploadRanges(message, text);
  const transferLength = Math.ceil(text.length / CHUNK_CHARS) * CHUNK_CHARS;
  return fraction => {
    if (!ranges.length) { report(fraction); return; }
    const delivered = Math.round(fraction * transferLength);
    const items = ranges.map(({ kind, index, start, end }) => ({ kind, index,
      percent: Math.max(0, Math.min(100, Math.floor((delivered - start) / (end - start) * 100))) }));
    report(fraction, items);
  };
}

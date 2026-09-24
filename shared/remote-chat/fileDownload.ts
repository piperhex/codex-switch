import { base64Bytes, checkDownloadSize, isDirectChat } from './policy';

export const FILE_CHUNK_BYTES = 256 * 1024;
// Reserve RPC/assembly capacity for chat and video, and bound read-ahead to 1 MiB of original bytes per download.
const DIRECT_READ_AHEAD = 4;
export interface FileInfo { id: string; size: number; name: string; mimeType: string; revision?: string }
export interface FileRead { threadId: string; id: string; offset: number; length: number }
export interface FileChunk { offset: number; data: string }
export type FileRequest =
  | { operation: 'fileOpen'; threadId: string; path: string; maxBytes?: number }
  | ({ operation: 'fileRead'; maxBytes?: number } & FileRead)
  | { operation: 'fileClose'; threadId: string; id: string };
export interface FileClient {
  open: (threadId: string, path: string) => Promise<FileInfo>;
  read: (request: FileRead) => Promise<FileChunk>;
  close: (threadId: string, id: string) => Promise<unknown>;
}
export interface DownloadTarget {
  write: (base64: string) => Promise<void>;
  finish: () => Promise<void>;
  dispose: () => Promise<void>;
}
export interface DownloadOptions {
  client: FileClient; threadId: string; path: string; signal: AbortSignal;
  target: (info: FileInfo) => Promise<DownloadTarget>;
  progress: (received: number, total: number) => void;
}
export class DownloadCancelled extends Error {}
function checkCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new DownloadCancelled();
}
export function validateFileInfo(info: FileInfo) {
  if (!info || typeof info.id !== 'string' || !/^[a-z\d-]{36}$/i.test(info.id)
    || !Number.isSafeInteger(info.size) || info.size < 0
    || typeof info.name !== 'string' || !info.name || /[\\/\x00-\x1f\x7f]/.test(info.name)
    || info.name === '.' || info.name === '..' || typeof info.mimeType !== 'string') {
    throw new Error('文件信息无效，请重试。');
  }
  checkDownloadSize(info.size);
  return info;
}
function validateChunk(chunk: FileChunk, offset: number, length: number) {
  if (!chunk || chunk.offset !== offset || typeof chunk.data !== 'string'
    || chunk.data.length !== Math.ceil(length / 3) * 4
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk.data)
    || base64Bytes(chunk.data) !== length) throw new Error('文件下载不完整，请重试。');
}
type ReadResult = { chunk: FileChunk } | { error: unknown };
interface PendingRead { offset: number; length: number; result: Promise<ReadResult> }
function readAhead(client: FileClient, request: FileRead): PendingRead {
  const result = client.read(request).then((chunk): ReadResult => ({ chunk }),
    (error: unknown): ReadResult => ({ error }));
  return { offset: request.offset, length: request.length, result };
}
async function transfer(options: DownloadOptions, info: FileInfo, target: DownloadTarget) {
  const { client, threadId, signal, progress } = options;
  const pending: PendingRead[] = [];
  let nextOffset = 0;
  const fill = () => {
    checkCancelled(signal);
    checkDownloadSize(info.size);
    const window = isDirectChat() ? DIRECT_READ_AHEAD : 1;
    while (pending.length < window && nextOffset < info.size) {
      const length = Math.min(FILE_CHUNK_BYTES, info.size - nextOffset);
      pending.push(readAhead(client, { threadId, id: info.id, offset: nextOffset, length }));
      nextOffset += length;
    }
  };
  progress(0, info.size);
  fill();
  while (pending.length) {
    const read = pending.shift()!;
    const result = await read.result;
    checkCancelled(signal);
    checkDownloadSize(info.size);
    if ('error' in result) throw result.error;
    validateChunk(result.chunk, read.offset, read.length);
    await target.write(result.chunk.data);
    progress(read.offset + read.length, info.size);
    fill();
  }
  checkCancelled(signal);
  await target.finish();
}
/** Pipeline bounded P2P reads, keep disk writes ordered, and always release local and remote resources. */
export async function downloadFile(options: DownloadOptions) {
  checkCancelled(options.signal);
  const info = await options.client.open(options.threadId, options.path);
  let target: DownloadTarget | undefined;
  try {
    validateFileInfo(info);
    checkCancelled(options.signal);
    target = await options.target(info);
    await transfer(options, info, target);
  } finally {
    await target?.dispose().catch(() => console.warn('Unable to remove temporary download'));
    if (typeof info?.id === 'string') {
      await options.client.close(options.threadId, info.id)
        .catch(() => console.warn('Unable to close remote download; it will expire automatically'));
    }
  }
}

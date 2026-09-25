import { DownloadCancelled, type DownloadTarget, type FileInfo }
  from '../../../../shared/remote-chat/fileDownload';

interface WritableFile {
  write: (bytes: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort: () => Promise<void>;
}
interface SaveHandle { createWritable: () => Promise<WritableFile> }
interface SavePicker { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<SaveHandle> }
const DOWNLOAD_URL_LIFETIME_MS = 60_000;
function bytes(data: string) { return Uint8Array.from(atob(data), (char) => char.charCodeAt(0)); }

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  // Keep the object alive while the browser starts saving the file.
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
}

async function writableTarget(writable: WritableFile): Promise<DownloadTarget> {
  let completed = false;
  return {
    write: (data) => writable.write(bytes(data)),
    finish: async () => { await writable.close(); completed = true; },
    dispose: async () => { if (!completed) await writable.abort(); },
  };
}

/** Prefer disk-backed browser storage; use a Blob on browsers without a writable filesystem. */
export async function browserDownloadTarget(info: FileInfo): Promise<DownloadTarget> {
  if (navigator.storage?.getDirectory) {
    const directory = await navigator.storage.getDirectory();
    const name = `chat-download-${crypto.randomUUID()}`;
    const handle = await directory.getFileHandle(name, { create: true });
    const target = await handle.createWritable().then(writableTarget).catch(async (error: unknown) => {
      await directory.removeEntry(name);
      throw error;
    });
    let published = false;
    return {
      write: target.write,
      finish: async () => {
        await target.finish(); downloadBlob(await handle.getFile(), info.name); published = true;
      },
      dispose: async () => {
        try { await target.dispose(); }
        finally {
          if (published) {
            // Allow the browser to consume the File snapshot before deleting its backing file.
            setTimeout(() => { void directory.removeEntry(name).catch(() => console.warn('Unable to clean download')); },
              DOWNLOAD_URL_LIFETIME_MS);
          } else await directory.removeEntry(name);
        }
      },
    };
  }
  const parts: Uint8Array[] = [];
  return {
    write: async (data) => { parts.push(bytes(data)); },
    finish: async () => downloadBlob(new Blob(parts, { type: info.mimeType }), info.name),
    dispose: async () => { parts.length = 0; },
  };
}

/** The picker must open directly from the click, before waiting for a remote request. */
export async function prepareBrowserDownload(path: string) {
  const picker = (window as Window & SavePicker).showSaveFilePicker;
  if (!picker) return browserDownloadTarget;
  try {
    const handle = await picker.call(window, { suggestedName: path.split(/[\\/]/).pop() || 'download' });
    return async () => writableTarget(await handle.createWritable());
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new DownloadCancelled();
    throw error;
  }
}

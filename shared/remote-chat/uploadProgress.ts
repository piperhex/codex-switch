export interface UploadItemProgress {
  kind: 'image' | 'attachment';
  index: number;
  percent: number;
}

export type TransferProgress = (fraction: number, items?: UploadItemProgress[]) => void;

export interface UploadProgress {
  phase: 'preparing' | 'uploading' | 'confirming';
  percent: number;
  items?: UploadItemProgress[];
}

/** Indexes match the submitted draft, including references that do not need uploading. */
export function itemUploadProgress(progress: UploadProgress | undefined, kind: UploadItemProgress['kind'], index: number) {
  if (!progress) return undefined;
  const item = progress.items?.find(entry => entry.kind === kind && entry.index === index);
  return { phase: progress.phase, percent: item?.percent ?? (progress.phase === 'confirming' ? 100 : 0) };
}

/** Only local attachment data needs transferring; project paths and plugins do not. */
export function hasUpload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const input = value as { images?: unknown; attachments?: unknown };
  return (Array.isArray(input.images) && input.images.some((image: unknown) =>
    typeof image === 'string' && image.startsWith('data:')))
    || (Array.isArray(input.attachments) && input.attachments.some((item: unknown) =>
      !!item && typeof item === 'object' && typeof (item as { data?: unknown }).data === 'string'
      && Boolean((item as { data: string }).data.length)));
}

export function uploadProgress(fraction: number): UploadProgress {
  return { phase: fraction >= 1 ? 'confirming' : 'uploading',
    percent: Math.max(0, Math.min(100, Math.floor(fraction * 100))) };
}

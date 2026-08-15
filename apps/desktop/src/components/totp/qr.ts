import jsQR from "jsqr";

const MAX_QR_IMAGE_BYTES = 10 * 1024 * 1024;
const PRIMARY_CANVAS_EDGE = 2_000;
const FALLBACK_CANVAS_EDGE = 1_600;
const FALLBACK_REGION_SIZE = 0.72;
const FALLBACK_REGION_OFFSET = 1 - FALLBACK_REGION_SIZE;
const IMAGE_FILE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|webp)$/i;

export type QrImageErrorCode =
  | "unsupported-image"
  | "image-load-failed"
  | "image-read-failed"
  | "qr-not-found";

export class QrImageError extends Error {
  constructor(readonly code: QrImageErrorCode) {
    super(code);
    this.name = "QrImageError";
  }
}

interface LoadedImage {
  element: HTMLImageElement;
  release: () => void;
}

interface ScanRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScanPass {
  maxEdge: number;
  smoothing: boolean;
  regions: ScanRegion[];
}

const FULL_IMAGE: ScanRegion = { x: 0, y: 0, width: 1, height: 1 };
const FALLBACK_REGIONS: ScanRegion[] = [
  { x: 0, y: 0, width: FALLBACK_REGION_SIZE, height: FALLBACK_REGION_SIZE },
  { x: FALLBACK_REGION_OFFSET, y: 0, width: FALLBACK_REGION_SIZE, height: FALLBACK_REGION_SIZE },
  { x: 0, y: FALLBACK_REGION_OFFSET, width: FALLBACK_REGION_SIZE, height: FALLBACK_REGION_SIZE },
  {
    x: FALLBACK_REGION_OFFSET,
    y: FALLBACK_REGION_OFFSET,
    width: FALLBACK_REGION_SIZE,
    height: FALLBACK_REGION_SIZE,
  },
];
const SCAN_PASSES: ScanPass[] = [
  { maxEdge: PRIMARY_CANVAS_EDGE, smoothing: true, regions: [FULL_IMAGE] },
  { maxEdge: FALLBACK_CANVAS_EDGE, smoothing: false, regions: [FULL_IMAGE] },
  { maxEdge: FALLBACK_CANVAS_EDGE, smoothing: true, regions: FALLBACK_REGIONS },
];

function isSupportedImage(file: File) {
  const recognizedType = file.type.startsWith("image/");
  const recognizedExtension = IMAGE_FILE_EXTENSION.test(file.name);
  return file.size <= MAX_QR_IMAGE_BYTES && (recognizedType || recognizedExtension);
}

function loadImage(file: File) {
  return new Promise<LoadedImage>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => resolve({
      element: image,
      release: () => URL.revokeObjectURL(objectUrl),
    });
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new QrImageError("image-load-failed"));
    };
    image.src = objectUrl;
  });
}

function renderRegion(image: HTMLImageElement, region: ScanRegion, pass: ScanPass) {
  const sourceX = Math.round(image.naturalWidth * region.x);
  const sourceY = Math.round(image.naturalHeight * region.y);
  const sourceWidth = Math.round(image.naturalWidth * region.width);
  const sourceHeight = Math.round(image.naturalHeight * region.height);
  const scale = Math.min(1, pass.maxEdge / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new QrImageError("image-read-failed");
  context.imageSmoothingEnabled = pass.smoothing;
  if (pass.smoothing) context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function decodeRegion(image: HTMLImageElement, region: ScanRegion, pass: ScanPass) {
  const pixels = renderRegion(image, region, pass);
  return jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" })?.data ?? "";
}

function yieldToInterface() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

async function scanImage(image: HTMLImageElement) {
  for (const pass of SCAN_PASSES) {
    for (const region of pass.regions) {
      const result = decodeRegion(image, region, pass);
      if (result) return result;
      await yieldToInterface();
    }
  }
  throw new QrImageError("qr-not-found");
}

export async function decodeQrImage(file: File) {
  if (!isSupportedImage(file)) throw new QrImageError("unsupported-image");
  const loaded = await loadImage(file);
  try {
    return await scanImage(loaded.element);
  } catch (cause) {
    if (cause instanceof QrImageError) throw cause;
    throw new QrImageError("image-read-failed");
  } finally {
    loaded.release();
  }
}

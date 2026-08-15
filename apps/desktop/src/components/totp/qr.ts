import jsQR from "jsqr";

const MAX_QR_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_QR_CANVAS_EDGE = 2_000;

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("image-load-failed"));
    };
    image.src = objectUrl;
  });
}

export async function decodeQrImage(file: File) {
  if (!file.type.startsWith("image/") || file.size > MAX_QR_IMAGE_BYTES) {
    throw new Error("unsupported-image");
  }
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_QR_CANVAS_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("canvas-unavailable");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" });
  if (!result?.data) throw new Error("qr-not-found");
  return result.data;
}

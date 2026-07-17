export const MAX_FEEDBACK_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_FEEDBACK_IMAGES = 4;
export const FEEDBACK_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to decode image"));
    };
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Unable to compress image"));
    }, "image/jpeg", quality);
  });
}

export async function prepareFeedbackImage(file: File): Promise<{ file: File; compressed: boolean }> {
  if (!(FEEDBACK_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("unsupported");
  }
  if (file.size <= MAX_FEEDBACK_IMAGE_BYTES) return { file, compressed: false };

  const source = await loadImage(file);
  const maxSourceSide = Math.max(source.naturalWidth, source.naturalHeight);
  let scale = Math.min(1, 4096 / maxSourceSide);
  let quality = 0.88;

  for (let attempt = 0; attempt < 14; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to compress image");
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    const blob = await canvasBlob(canvas, quality);
    if (blob.size <= MAX_FEEDBACK_IMAGE_BYTES) {
      const baseName = file.name.replace(/\.[^.]+$/, "") || "feedback-image";
      return {
        file: new File([blob], `${baseName}-compressed.jpg`, {
          type: "image/jpeg",
          lastModified: Date.now(),
        }),
        compressed: true,
      };
    }

    if (quality > 0.58) quality -= 0.1;
    else scale *= 0.8;
  }
  throw new Error("Unable to compress image below 5 MB");
}

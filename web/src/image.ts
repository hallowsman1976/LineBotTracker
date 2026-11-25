// Turns a photo picked from the gallery into a small JPEG for the API (Gemini reads JPEG; Apps Script
// payloads should stay small). Screenshots of slips are tall, so the long side is what gets capped.

const MAX_SIDE = 2000;
const QUALITY = 0.85;

export interface PreparedImage {
  /** Base64 JPEG without the data: prefix. */
  base64: string;
  /** Object URL of the JPEG, for the thumbnail. Revoke when done. */
  url: string;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const source = await decode(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  // Transparent PNG screenshots would turn black in JPEG.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source.image, 0, 0, canvas.width, canvas.height);
  source.close();

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', QUALITY),
  );
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), url: URL.createObjectURL(blob) };
}

interface Decoded {
  image: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

async function decode(file: File): Promise<Decoded> {
  if ('createImageBitmap' in window) {
    try {
      // from-image applies EXIF rotation, so phone photos are not sideways.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Some browsers reject the options or the format; the <img> path below may still work.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Decode a photo straight to working resolution. Camera photos can be 50 MP
 * (about 200 MB as RGBA), so we never keep a full-resolution copy around.
 */

export class DecodeError extends Error {}

/** Largest side for processing: enough for a 1600 px tall phone screen. */
export function workingMaxSide(): number {
  const mem = (navigator as { deviceMemory?: number }).deviceMemory;
  return mem !== undefined && mem < 4 ? 1024 : 1536;
}

export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new DecodeError('This browser cannot open that image format. Try a JPEG or PNG photo.'));
    img.src = url;
  });
}

export async function decodeForProcessing(file: Blob, maxSide = workingMaxSide()): Promise<ImageBitmap> {
  const url = URL.createObjectURL(file);
  try {
    // An <img> reports EXIF-rotated dimensions without us decoding every pixel.
    const img = await loadImage(url);
    const target = fitWithin(img.naturalWidth, img.naturalHeight, maxSide);
    let bmp: ImageBitmap | null = null;
    try {
      bmp = await createImageBitmap(file, {
        resizeWidth: target.width,
        resizeHeight: target.height,
        resizeQuality: 'high',
        imageOrientation: 'from-image',
      });
    } catch {
      bmp = null;
    }
    // Some browsers apply the resize before EXIF rotation; fall back to drawing the <img>.
    if (!bmp || Math.abs(bmp.width / bmp.height - target.width / target.height) > 0.02) {
      bmp?.close();
      const c = document.createElement('canvas');
      c.width = target.width;
      c.height = target.height;
      const ctx = c.getContext('2d');
      if (!ctx) throw new DecodeError('Could not prepare the photo.');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, target.width, target.height);
      bmp = await createImageBitmap(c);
      c.width = c.height = 0;
    }
    return bmp;
  } finally {
    URL.revokeObjectURL(url);
  }
}

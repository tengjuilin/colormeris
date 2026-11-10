// Reading pixels of an RGBA image buffer.
import { onWhite } from './color.ts';
import type { PixelImage, Rgb } from './types.ts';

// Read one pixel as [r, g, b], compositing transparency onto white.
export function readPixel(img: PixelImage, x: number, y: number): Rgb {
  const xi = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const yi = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  const i = (yi * img.width + xi) * 4;
  const d = img.data;
  const a = d[i + 3] / 255;
  if (a >= 1) return [d[i], d[i + 1], d[i + 2]];
  return [onWhite(d[i], a), onWhite(d[i + 1], a), onWhite(d[i + 2], a)];
}

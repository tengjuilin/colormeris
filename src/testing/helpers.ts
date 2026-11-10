// Synthetic image helpers for tests.

import type { PixelImage, Rgb } from '../types/index.ts';

export function makeImage(width: number, height: number, fill: number[] = [255, 255, 255, 255]): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(fill, i * 4);
  return { width, height, data };
}

export function setPixel(img: PixelImage, x: number, y: number, [r, g, b]: Rgb) {
  const i = (y * img.width + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = 255;
}

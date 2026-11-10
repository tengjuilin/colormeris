// Synthetic image helpers for the package's tests (copied from the app's src/testing/helpers.ts).
import type { PixelImage, Rgb } from './types.ts';

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

// Piecewise-linear RGB colormap through stops, s in [0, 1].
export function cmap(stops: Rgb[], s: number): Rgb {
  const x = Math.min(1, Math.max(0, s)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  return stops[i].map((c, k) => Math.round(c + f * (stops[i + 1][k] - c)));
}

export const VIRIDISH: Rgb[] = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

// Vertical colorbar from (x0..x1) spanning y0 (s=1, top) to y1 (s=0, bottom).
export function paintColorbar(img: PixelImage, x0: number, x1: number, y0: number, y1: number, stops: Rgb[]) {
  for (let y = y0; y <= y1; y++) {
    const s = (y1 - y) / (y1 - y0);
    for (let x = x0; x <= x1; x++) setPixel(img, x, y, cmap(stops, s));
  }
}

import type { Rgb } from '../types/index.ts';

// Paints a colormap strip: one canvas pixel per color, stretched by CSS. Shared by
// app/shared/strip.tsx. Returns false when
// there is no 2D context (jsdom), so tests can render strips without a canvas.
export function paintStrip(canvas: HTMLCanvasElement, colors: Rgb[]): boolean {
  const g = canvas.getContext('2d');
  if (!g || typeof ImageData === 'undefined') return false;
  const n = Math.max(1, colors.length);
  const img = new ImageData(n, 1);
  colors.forEach((c, i) => img.data.set([c[0], c[1], c[2], 255], i * 4));
  g.putImageData(img, 0, 0);
  return true;
}

/** A strip canvas for plot legends: `paintStrip` on a new canvas, as <Strip> renders it. */
export function stripCanvasEl(colors: Rgb[], qualitative: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = qualitative ? 'cmap-paint qual' : 'cmap-paint';
  canvas.width = Math.max(1, colors.length);
  canvas.height = 1;
  canvas.setAttribute('aria-hidden', 'true');
  paintStrip(canvas, colors);
  return canvas;
}

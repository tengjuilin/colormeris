import type { Rgb } from '../types/index.ts';

// Paints a colormap strip: one canvas pixel per color, stretched by CSS. Shared by
// strips.ts (imperative strips) and app/shared/strip.tsx (React). Returns false when
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

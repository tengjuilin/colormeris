// Thresholds and pixel tests shared by the locate modules: page background,
// noise, ink and stroke tests, runs of full lines, connected components.

import type { PixelImage, Rgb } from '../../types/index.ts';
import { readPixel } from '../grid.ts';
import type { Component, PixelTest } from './types.ts';

export const FILL = 0.75; // share of ink along a line that makes it part of a block
export const INK = 40; // channel difference from the background that counts as ink
// Growing a block over its palest cells: a line stays in the block while
// this share of it is covered by runs of cell color (see `cellRuns`).
export const FAINT_FILL = 0.1;
// Shortest run of cell color, in pixels, that counts in a grown line: tick
// marks, dendrogram leaves and the strokes of text across it are thinner.
export const MIN_RUN = 5;
// Furthest a frame line may sit past the block, as a share of its size.
export const FRAME_GAP = 0.06;
export const FRAME_LINE = 4;
// Thickest frame (in lines) whose middle a block's edge moves to, and
// thickest one taken in from outside the block (a blurred 2 px frame).
export const MAX_FRAME = 12;
export const THIN_FRAME = 6;
// Lines across cells beyond a white gap must cover this share of the
// block's whole span: a colorbar beside the cells is shorter (80% of
// the cells' height in one figure).
export const SPAN_FILL = 0.85;
export const TEXT = 90; // channel difference from the background of dark text
// Text, tick marks, frames and dendrograms are gray and much darker than
// the page: lightness gap and largest chroma (max − min channel).
export const STRONG = 60;
export const NEUTRAL = 30;
// Least chroma of a pale cell (unless the colormap is gray).
export const MIN_CHROMA = 6;
// Gaps and white grid lines between cells are told from pale cells with
// this tolerance at least: JPEG noise in a 5 px gap reaches 8 levels.
export const PALE = 14;

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const median = (v: ArrayLike<number>) => {
  const s = Array.from(v).sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};
export const mean = (rgb: Rgb) => (rgb[0] + rgb[1] + rgb[2]) / 3;

// Page background near a box: the most common color on the window's
// border (in steps of 16). Not the median: the border can cross a
// neighbouring heatmap or the colorbar for more than half its length.
export function background(img: PixelImage, x0: number, y0: number, x1: number, y1: number): Rgb {
  const bins = new Map<string, { n: number; sum: number[] }>();
  const add = (x: number, y: number) => {
    const rgb = readPixel(img, x, y);
    const key = rgb.map((v) => v >> 4).join();
    const b = bins.get(key) || { n: 0, sum: [0, 0, 0] };
    b.n++;
    rgb.forEach((v, i) => (b.sum[i] += v));
    bins.set(key, b);
  };
  for (let x = x0; x < x1; x += 2) [add(x, y0), add(x, y1 - 1)];
  for (let y = y0; y < y1; y += 2) [add(x0, y), add(x1 - 1, y)];
  let best: { n: number; sum: number[] } | null = null;
  for (const b of bins.values()) if (!best || b.n > best.n) best = b;
  return best!.sum.map((v) => v / best!.n);
}

// How far the page itself strays from its background color (JPEG noise,
// paper texture): the 90th percentile over the window's border pixels
// that are near the background (within 10 levels: pale cells of a
// neighbour on the border are not noise), doubled, and at least 4 levels.
export function noiseTol(img: PixelImage, x0: number, y0: number, x1: number, y1: number, bg: Rgb) {
  const dev: number[] = [];
  const add = (x: number, y: number) => {
    const rgb = readPixel(img, x, y);
    const d = Math.max(Math.abs(rgb[0] - bg[0]), Math.abs(rgb[1] - bg[1]), Math.abs(rgb[2] - bg[2]));
    if (d < 10) dev.push(d);
  };
  for (let x = x0; x < x1; x += 2) [add(x, y0), add(x, y1 - 1)];
  for (let y = y0; y < y1; y += 2) [add(x0, y), add(x1 - 1, y)];
  dev.sort((a, b) => a - b);
  return Math.max(4, 2 * (dev[Math.floor(0.9 * (dev.length - 1))] || 0));
}

export const differs =
  (bg: Rgb, tol: number): PixelTest =>
  (rgb) =>
    Math.max(Math.abs(rgb[0] - bg[0]), Math.abs(rgb[1] - bg[1]), Math.abs(rgb[2] - bg[2])) > tol;
// Gray and much darker (or lighter) than the page: lines and text.
export const stroke =
  (bg: Rgb): PixelTest =>
  (rgb) =>
    Math.max(...rgb) - Math.min(...rgb) < NEUTRAL && Math.abs(mean(rgb) - mean(bg)) > STRONG;

// Runs of positions where profile[i] >= FILL, as [from, to] (inclusive, offset by `lo`).
export function runs(profile: number[], lo: number) {
  const out: [number, number][] = [];
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] < FILL) continue;
    let j = i;
    while (j + 1 < profile.length && profile[j + 1] >= FILL) j++;
    out.push([lo + i, lo + j]);
    i = j;
  }
  return out;
}

// Connected components (8-neighbour) of `mask(x, y)` inside a window, as
// bounding boxes with pixel counts.
export function components(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  mask: (x: number, y: number) => boolean,
): Component[] {
  const W = x1 - x0;
  const H = y1 - y0;
  const on = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) on[y * W + x] = mask(x0 + x, y0 + y) ? 1 : 0;
  const out: Component[] = [];
  const stack: number[] = [];
  for (let i = 0; i < on.length; i++) {
    if (on[i] !== 1) continue;
    on[i] = 2;
    stack.push(i);
    const c = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, n: 0 };
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % W;
      const y = (j - x) / W;
      c.n++;
      c.x0 = Math.min(c.x0, x);
      c.x1 = Math.max(c.x1, x);
      c.y0 = Math.min(c.y0, y);
      c.y1 = Math.max(c.y1, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const k = ny * W + nx;
          if (on[k] === 1) {
            on[k] = 2;
            stack.push(k);
          }
        }
      }
    }
    out.push({ x0: c.x0 + x0, y0: c.y0 + y0, x1: c.x1 + x0 + 1, y1: c.y1 + y0 + 1, n: c.n });
  }
  return out;
}

// Colorbar strips: pixel tests for bars and following a strip to its ends.

import type { Box, PixelImage, Rgb } from '../../types/index.ts';
import { readPixel } from '../grid.ts';
import { background, clamp, differs, FILL, mean, NEUTRAL, noiseTol, PALE, stroke } from './helpers.ts';
import type { Bar } from './types.ts';

// Colorbars. A colorbar is a strip at least BAR_THICK px thick and 3 times
// as long, whose color changes along it (smoothly or in bins) and not
// across it. Its pixels are found by their difference from the page, not
// by chroma alone: a diverging bar has a white middle and a pale bar a
// near-white end, which once split a bar in two or cut it short.
export const BAR_THICK = 4;
const BAR_CHROMA = 10; // least chroma of a colorbar pixel off its white parts
export const BAR_STEP = 15; // least change over 3 lines at a bin edge

export type BarTools = ReturnType<typeof barTools>;

// Pixel tests for colorbars on the page around `region`.
export function barTools(img: PixelImage, region: Box) {
  const x0 = clamp(Math.floor(region.x0), 0, img.width - 1);
  const y0 = clamp(Math.floor(region.y0), 0, img.height - 1);
  const x1 = clamp(Math.ceil(region.x1), x0 + 1, img.width);
  const y1 = clamp(Math.ceil(region.y1), y0 + 1, img.height);
  const bg = background(img, x0, y0, x1, y1);
  const pale = differs(bg, Math.max(noiseTol(img, x0, y0, x1, y1, bg), PALE));
  const strong = stroke(bg);
  const chroma = (rgb: Rgb) => Math.max(...rgb) - Math.min(...rgb);
  // Tinted, and not a near-black outline (a dark red frame is 20 levels
  // of chroma; a gray-blue end of a colormap is lighter).
  const colored = (rgb: Rgb) => pale(rgb) && chroma(rgb) >= BAR_CHROMA && !(strong(rgb) && mean(rgb) < 100);
  return { x0, y0, x1, y1, bg, pale, strong, colored };
}

// The strip that a seed box (a colored component, or a rough box around a
// bar) lies on: its cross-section [c0, c1) where most of the seed's lines
// are colored, then its ends along the axis. The ends are followed past
// the seed over colored lines, a dark end (4 or more gray lines, such as
// magma's black), white lines inside a frame (both sides of the strip are
// gray strokes) and a white gap no longer than the strip is thick with
// the strip going on beyond it (the white middle of a diverging bar). A
// frame's end cap is left out. Returns {x0, y0, x1, y1, vertical} or null.
export function followStrip(img: PixelImage, B: BarTools, seed: Box, vertical: boolean): Bar | null {
  const W = img.width;
  const H = img.height;
  const px = (u: number, c: number) => (vertical ? readPixel(img, c, u) : readPixel(img, u, c));
  const [u0, u1, k0, k1] = vertical ? [seed.y0, seed.y1, seed.x0, seed.x1] : [seed.x0, seed.x1, seed.y0, seed.y1];
  const uEnd = vertical ? H : W;
  const cEnd = vertical ? W : H;
  // Cross-section: lines across the middle half of the seed that are colored.
  const across = (c: number) => {
    let n = 0;
    let t = 0;
    const a = u0 + 0.25 * (u1 - u0);
    const b = u1 - 0.25 * (u1 - u0);
    for (let u = a; u < b; u += Math.max(1, (b - a) / 40), t++) if (B.colored(px(Math.round(u), c))) n++;
    return t ? n / t : 0;
  };
  let c0 = Math.round(k0);
  let c1 = Math.round(k1);
  const mid = Math.round((c0 + c1) / 2);
  if (across(mid) < 0.5) {
    // A rough box: the best line near its middle.
    let best = -1;
    for (let c = c0; c < c1; c++) if (best < 0 || across(c) > across(best)) best = c;
    if (best < 0 || across(best) < 0.5) return null;
    c0 = c1 = best;
    c1++;
  } else [c0, c1] = [mid, mid + 1];
  while (c0 > 0 && across(c0 - 1) >= 0.5) c0--;
  while (c1 < cEnd && across(c1) >= 0.5) c1++;
  const thick = c1 - c0;
  if (thick < BAR_THICK) return null;
  // Shares of one line across the strip (its outer pixels left out).
  const m = thick > 6 ? 1 : 0;
  const stats = (u: number) => {
    let col = 0;
    let page = 0;
    let dark = 0;
    let mid = 0;
    const q = Math.floor(thick / 4);
    for (let c = c0 + m; c < c1 - m; c++) {
      const rgb = px(u, c);
      if (B.colored(rgb)) col++;
      else if (!B.pale(rgb)) page++;
      else if (B.strong(rgb)) dark++;
      if (c >= c0 + q && c < c1 - q && B.pale(rgb)) mid++;
    }
    const t = c1 - c0 - 2 * m;
    // `mid`: off the page across the middle half (a pale gray middle
    // of a diverging bar blurs into the page at its sides).
    return { col: col / t, page: page / t, dark: dark / t, mid: mid / (c1 - c0 - 2 * q) };
  };
  // A frame line on both sides: gray and off the page (a 1 px light gray
  // outline blurs to 40 levels).
  const line = (rgb: Rgb) => B.pale(rgb) && Math.max(...rgb) - Math.min(...rgb) < NEUTRAL;
  const sideFramed = (u: number) =>
    [-1, 0, 1, 2, 3].some((i) => c0 - i >= 0 && line(px(u, c0 - i))) &&
    [-2, -1, 0, 1, 2].some((i) => c1 + i < cEnd && line(px(u, c1 + i)));
  const inside = (u: number) => u >= 0 && u < uEnd;
  const follow = (start: number, dir: number) => {
    let u = start;
    for (;;) {
      const v = u + dir;
      if (!inside(v)) return u;
      const s = stats(v);
      if (s.col >= FILL || (s.mid >= FILL && !(s.dark >= FILL))) {
        u = v;
        continue;
      }
      if (s.dark >= FILL) {
        let k = 0;
        while (k < BAR_THICK && inside(v + dir * k) && stats(v + dir * k).dark >= FILL) k++;
        if (k >= BAR_THICK) {
          u = v + dir * (k - 1);
          continue;
        }
        return u; // a frame's end cap
      }
      if (s.dark < 0.5 && sideFramed(v)) {
        u = v;
        continue;
      }
      // A white gap, then more of the strip.
      let g = 1;
      while (g <= thick && inside(v + dir * g) && stats(v + dir * g).page >= FILL) g++;
      // Past the gap the strip goes on and turns colored within its
      // thickness (not a gray legend box below the bar).
      const at = (i: number) => (inside(v + dir * (g + i)) && stats(v + dir * (g + i))) as ReturnType<typeof stats>;
      // (after up to 2 blurred lines)
      let i = [0, 1, 2].find((i) => at(i) && at(i).mid >= FILL) ?? 0;
      const goesOn = [0, 1, 2].every((k) => at(i + k) && at(i + k).mid >= FILL);
      while (goesOn && i < thick && at(i) && at(i).mid >= FILL && at(i).col < FILL) i++;
      if (g <= thick && goesOn && at(i) && at(i).col >= FILL) {
        u = v + dir * g;
        continue;
      }
      return u;
    }
  };
  // Start on the colored line nearest the seed's middle.
  let start = Math.round((u0 + u1) / 2);
  for (let d = 0; d < (u1 - u0) / 2; d++) {
    if (stats(start + d).col >= FILL) [(start += d), (d = Infinity)];
    else if (stats(start - d).col >= FILL) [(start -= d), (d = Infinity)];
  }
  const a = follow(start, -1);
  const b = follow(start, 1) + 1;
  const len = b - a;
  if (len < 3 * thick) return null;
  return vertical ? { x0: c0, y0: a, x1: c1, y1: b, vertical } : { x0: a, y0: c0, x1: b, y1: c1, vertical };
}

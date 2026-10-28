// Line measures around a rough box and frame fitting, shared by snapBlock and
// snapEdges.

import type { Box, PixelImage, Rgb } from '../../types/index.ts';
import { readPixel } from '../grid.ts';
import {
  background,
  clamp,
  differs,
  FILL,
  INK,
  MAX_FRAME,
  MIN_CHROMA,
  MIN_RUN,
  median,
  noiseTol,
  PALE,
  stroke,
  THIN_FRAME,
} from './helpers.ts';
import type { PixelTest } from './types.ts';

interface Separator {
  i: number;
  j: number;
  kind: 'blank' | 'stroke' | null;
}

// Pixel tests and line measures around a rough box, shared by snapBlock
// and snapEdges. A line is a column (`horizontal`: positions along x) or
// a row, read over a span [s0, s1) of the other axis.
export function lineTools(img: PixelImage, wx0: number, wy0: number, wx1: number, wy1: number, inside: Box) {
  const bg = background(img, wx0, wy0, wx1, wy1);
  const ink = differs(bg, INK);
  const tol = noiseTol(img, wx0, wy0, wx1, wy1, bg);
  const faint = differs(bg, tol);
  const pale = differs(bg, Math.max(tol, PALE));
  const strong = stroke(bg);
  const chroma = (rgb: Rgb) => Math.max(...rgb) - Math.min(...rgb);
  // Gray cells (a gray colormap): most ink in the middle of the box is gray.
  let gray = 0;
  let inked = 0;
  for (let y = inside.y0; y < inside.y1; y += Math.max(1, (inside.y1 - inside.y0) / 30))
    for (let x = inside.x0; x < inside.x1; x += Math.max(1, (inside.x1 - inside.x0) / 30)) {
      const rgb = readPixel(img, x, y);
      if (ink(rgb)) [inked++, chroma(rgb) < 16 && gray++];
    }
  const grayCells = inked > 0 && gray >= 0.6 * inked;
  // Off the page, not a gray stroke and tinted (unless the cells are
  // gray): the color of cells, even pale ones. The gray halo of text and
  // lines is not.
  const tinted: PixelTest = (rgb) => faint(rgb) && !strong(rgb) && (grayCells || chroma(rgb) >= MIN_CHROMA);
  const line = (horizontal: boolean, s0: number, s1: number, n = 200) => {
    s0 = Math.round(s0);
    s1 = Math.max(s0 + 1, Math.round(s1));
    const step = Math.max(1, Math.floor((s1 - s0) / n));
    const px = (a: number, b: number) => (horizontal ? readPixel(img, a, b) : readPixel(img, b, a));
    const share = (a: number, test: PixelTest) => {
      let k = 0;
      let t = 0;
      for (let b = s0; b < s1; b += step, t++) if (test(px(a, b))) k++;
      return k / t;
    };
    // The share without the samples in `parts` (separators: the white
    // gaps between cells across the span, which are no cells).
    const masks = new Map<Separator[], Uint8Array>();
    const shareOff = (a: number, test: PixelTest, parts: Separator[] = []) => {
      let skip = masks.get(parts);
      if (!skip) {
        skip = new Uint8Array(Math.ceil((s1 - s0) / step) + 1);
        for (const p of parts) skip.fill(1, p.i, p.j);
        masks.set(parts, skip);
      }
      let k = 0;
      let t = 0;
      for (let b = s0, i = 0; b < s1; b += step, i++) {
        if (skip[i]) continue;
        t++;
        if (test(px(a, b))) k++;
      }
      return t ? k / t : 0;
    };
    // Share of the span covered by runs of cell color at least MIN_RUN
    // pixels long. Pale cells give long runs; tick marks, dendrogram
    // leaves and text give short runs or gray strokes.
    const cellRuns = (a: number) => {
      const minRun = Math.max(2, Math.ceil(MIN_RUN / step));
      let covered = 0;
      let run = 0;
      let t = 0;
      for (let b = s0; b < s1; b += step, t++) {
        if (tinted(px(a, b))) run++;
        else [run >= minRun && (covered += run), (run = 0)];
      }
      if (run >= minRun) covered += run;
      return covered / t;
    };
    // Runs of positions on the span where nearly all lines in [from, to)
    // are page or gray strokes: white or dark grid lines between cells,
    // as {i, j, kind} (sample indices, kind 'blank' or 'stroke').
    const separators = (from: number, to: number): Separator[] => {
      const stride = Math.max(1, Math.floor((to - from) / 60));
      const kinds: Separator['kind'][] = [];
      for (let b = s0; b < s1; b += step) {
        let blank = 0;
        let dark = 0;
        let t = 0;
        for (let a = from; a < to; a += stride, t++) {
          const rgb = px(a, b);
          if (!pale(rgb)) blank++;
          else if (strong(rgb)) dark++;
        }
        kinds.push(blank >= 0.85 * t ? 'blank' : dark >= 0.85 * t ? 'stroke' : null);
      }
      const parts: Separator[] = [];
      for (let i = 0; i < kinds.length; ) {
        let j = i;
        while (j < kinds.length && kinds[j] === kinds[i]) j++;
        parts.push({ i, j, kind: kinds[i] });
        i = j;
      }
      // A frame near the span's ends is not a grid line, and neither is
      // a run as wide as half a cell (a column of white cells).
      const cell = median(parts.filter((p) => !p.kind).map((p) => p.j - p.i));
      const ends = Math.max(1, Math.round(0.03 * kinds.length));
      return parts.filter((p) => p.kind && p.i >= ends && p.j <= kinds.length - ends && p.j - p.i <= 0.5 * cell);
    };
    // Whether a line keeps the block's grid lines: at least half of them
    // show the same page or stroke color, or at least a clear dip toward
    // it from the cells on both sides (a 1 px white line between pale
    // cells blurs to a few levels off the page). Give or take a sample.
    // A colorbar, a solid group strip or text beside the cells does not.
    // One grid line is too little to judge by.
    const at = (a: number, i: number) => px(a, clamp(s0 + i * step, s0, s1 - 1));
    const off = (rgb: Rgb) => Math.max(Math.abs(rgb[0] - bg[0]), Math.abs(rgb[1] - bg[1]), Math.abs(rgb[2] - bg[2]));
    const keepsGrid = (a: number, sep: Separator[]) => {
      if (sep.length < 2) return true;
      const same = sep.filter((p) => {
        const sides = Math.min(off(at(a, p.i - 3)), off(at(a, p.j + 2)));
        for (let i = p.i - 1; i <= p.j; i++) {
          const rgb = at(a, i);
          if (p.kind === 'blank' ? !pale(rgb) || (sides >= 2 * PALE && off(rgb) <= 0.6 * sides) : strong(rgb))
            return true;
        }
        return false;
      }).length;
      return same >= 0.5 * sep.length;
    };
    return { px, share, shareOff, cellRuns, separators, keepsGrid, step, s0, s1 };
  };
  return { bg, ink, faint, pale, strong, tinted, line };
}

type LineTools = ReturnType<typeof lineTools>;

// Fits a block's edge to a frame around the cells: the edge goes to the
// frame's middle line, where a grid line between cells would be. A thin
// frame within 4 lines outside the edge is taken in first; ticks, labels
// and a colorbar beyond it are not. Frame lines are mostly gray strokes
// over [s0, s1); a blurred 2 px frame spans 3 to 5 such lines. `edge` is
// the block's outermost line, `dir` points into the block, `end` is the
// image size on this axis. Returns the new outermost line.
export function fitFrame(
  T: LineTools,
  horizontal: boolean,
  edge: number,
  dir: number,
  s0: number,
  s1: number,
  size: number,
  end: number,
) {
  const L = T.line(horizontal, s0, s1);
  const frameLine = (a: number) => a >= 0 && a < end && L.share(a, T.strong) >= FILL;
  for (let o = 1; o <= 4; o++) {
    if (!frameLine(edge - dir * o)) continue;
    let n = 0;
    while (n <= THIN_FRAME && frameLine(edge - dir * (o + n))) n++;
    if (n <= THIN_FRAME) edge -= dir * (o + n - 1);
    break;
  }
  let o = 0;
  while (o <= 3 && !frameLine(edge + dir * o)) o++;
  if (o > 3) return edge;
  let k = 0;
  while (k <= MAX_FRAME && k < size / 3 && frameLine(edge + dir * (o + k))) k++;
  return k > MAX_FRAME ? edge : edge + dir * (o + Math.floor((k - 1) / 2));
}

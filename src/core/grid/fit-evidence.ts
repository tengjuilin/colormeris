// Evidence for cell borders along one axis (used by fitCellCounts).

import type { Corners, PixelImage } from '../../types/index.ts';
import { bilinear } from './geometry.ts';
import { median, readPixel } from './sampling.ts';

// ---- Cell counts from cell borders ---------------------------------------
//
// fitCellCounts looks for where the cell borders are, not only how far
// apart edges are (detectGridSize): a comb of evenly spaced teeth that land
// on color edges while the cell middles between them stay flat. Its cell
// size and start are fitted freely, so corners a few pixels off, or a frame,
// tick marks or a margin inside the box, do not change the count (fitting
// k cells exactly between the corners did: a 7 px frame on 37 px rows gave
// 339 rows for 40). Evidence for a border is the share of lines across the
// grid that change color there, not the mean change: a dendrogram or a
// label touching a few lines is strong but rare, and borders between
// near-equal replicate cells are faint but show on many lines.

export const FIT_LINES = 64;
// Lines come from the middle 80% of the other axis, so a frame or margin
// at the ends of a rough box does not hide the borders.
const FIT_INSET = 0.1;
// A color step (|ΔR|+|ΔG|+|ΔB| over two samples) counts above this, or
// above twice the image's noise when that is larger.
// Replicate cells differ by 16–23 on the 32 × 9 cytokine heatmap.
const STEP_MIN = 12;
// A border counts in full when this share of lines changes color there:
// neighbouring cells of equal color hide the rest.
const BORDER_SHARE = 0.3;
// Counts within this score of the best one are ties; the most cells win
// (3 cells per tooth fit as well as 1 when every border is strong).
export const COUNT_TIE = 0.08;
// Below this the borders are not where any even spacing puts them.
export const MIN_FIT = 0.25;
// The smallest cell, in pixels (antialiased 1–2 px lines are not cells).
export const MIN_CELL_PX = 3;
// Page white: every channel at least this.
const GAP_WHITE = 245;

/** Border evidence per sample of one axis (borderEvidence). */
export interface Evidence {
  edge: Float64Array;
  ramp: Float64Array;
  light: Float64Array;
  sep: Uint8Array;
}

/** A comb of cell size P (samples) starting at `phase`, with its search score. */
export interface CombFit {
  P: number;
  phase: number;
  r: number;
  score: number;
}

/** fitProfile's result for one axis. */
export interface AxisFit {
  count: number;
  score: number;
  rank: number;
  alt: number | null;
  altScore: number;
  size: number;
  sizeSamples: number;
  span: number[];
  reason: string;
  wideRun?: boolean;
  runs?: number;
}

// Colors along one axis: entry (j * N + i) * 3 is line j, sample i.
export function axisColors(img: PixelImage, corners: Corners, axis: 'u' | 'v', N: number, lines: number) {
  const out = new Float32Array(lines * N * 3);
  for (let j = 0; j < lines; j++) {
    const w = FIT_INSET + ((1 - 2 * FIT_INSET) * (j + 0.5)) / lines;
    for (let i = 0; i < N; i++) {
      const s = (i + 0.5) / N;
      const p = axis === 'u' ? bilinear(corners, s, w) : bilinear(corners, w, s);
      out.set(readPixel(img, p.x, p.y), (j * N + i) * 3);
    }
  }
  return out;
}

// Per sample: `edge`, the share of lines whose color changes most steeply
// there; `ramp`, the share changing at all; `light`, the share that is page
// white; and `sep`, whether it is a separator: one neutral color (a white
// gap, a black or gray line, a frame) on nearly all lines. A column of
// cells is never one color on every line, unless all its cells are equal.
export function borderEvidence(rgb: Float32Array, N: number, lines: number): Evidence {
  const steps = new Float32Array(lines * N);
  const at = (j: number, i: number) => (j * N + i) * 3;
  for (let j = 0; j < lines; j++)
    for (let i = 1; i < N - 1; i++) {
      const a = at(j, i - 1);
      const b = at(j, i + 1);
      steps[j * N + i] =
        Math.abs(rgb[a] - rgb[b]) + Math.abs(rgb[a + 1] - rgb[b + 1]) + Math.abs(rgb[a + 2] - rgb[b + 2]);
    }
  // Above the noise: JPEG artifacts make a quarter of the steps 13 or more
  // on some figures, and none on a clean one.
  const sorted = Float32Array.from(steps).sort();
  const T = Math.max(STEP_MIN, 2 * sorted[Math.floor(0.75 * (sorted.length - 1))]);
  const edge = new Float64Array(N);
  const ramp = new Float64Array(N);
  const light = new Float64Array(N);
  const sep = new Uint8Array(N);
  const ch = [new Float32Array(lines), new Float32Array(lines), new Float32Array(lines)];
  // A blurred or upscaled border changes color over several samples; it
  // counts once per line, where the change is steepest.
  const steepest = (j: number, i: number) => {
    const d = steps[j * N + i];
    for (let k = Math.max(1, i - 2); k <= Math.min(N - 2, i + 2); k++)
      if (steps[j * N + k] > d || (steps[j * N + k] === d && k < i)) return false;
    return true;
  };
  for (let i = 0; i < N; i++) {
    let n = 0;
    let r = 0;
    for (let j = 0; j < lines; j++) {
      if (steps[j * N + i] > T) r++, steepest(j, i) && n++;
      for (let k = 0; k < 3; k++) ch[k][j] = rgb[at(j, i) + k];
    }
    edge[i] = n / lines;
    ramp[i] = r / lines;
    let w = 0;
    for (let j = 0; j < lines; j++) w += Number(Math.min(ch[0][j], ch[1][j], ch[2][j]) >= GAP_WHITE);
    light[i] = w / lines;
    const m = ch.map((c) => median(Float32Array.from(c)));
    if (Math.max(...m) - Math.min(...m) > 30) continue;
    let same = 0;
    for (let j = 0; j < lines; j++)
      if (Math.abs(ch[0][j] - m[0]) + Math.abs(ch[1][j] - m[1]) + Math.abs(ch[2][j] - m[2]) <= 30) same++;
    // 2 for a dark line (frame, black grid line), 1 for a light one.
    sep[i] = same >= 0.9 * lines ? (Math.max(...m) < 128 ? 2 : 1) : 0;
  }
  return { edge, ramp, light, sep };
}

// Each separator run between cells, with the color ramps into and out of
// it, becomes one border at its middle, so a white gap counts once, not as
// two edges (5 × 5 cells with 8 px gaps came out 10 × 10). With `compress`
// the run also shrinks to that one sample, so groups of cells split by
// gaps wider than the lines inside a group fall on one even spacing; this
// is tried as well, since it shifts every later border when only some
// lines between cells are found (rows 1–2 px apart on a JPEG). Runs at the
// ends (frame, margin) stay, and so do runs `maxRun` wide or more (a
// column of white cells). `orig` maps samples back.
export function collapseSeparators({ edge, ramp, light, sep }: Evidence, maxRun: number, compress: boolean) {
  const N = edge.length;
  // Noise puts steps anywhere on a share of lines; most samples are not
  // borders, so a high quantile of the shares is that noise level.
  const base = Float64Array.from(edge).sort()[Math.floor(0.75 * (N - 1))];
  const b: number[] = [];
  const orig: number[] = [];
  const isSep: number[] = [];
  const pale: number[] = [];
  const runs: [number, number][] = [];
  let done = 0; // the last sample of the previous run, which stays put
  const keep = (i: number) => {
    b.push(Math.min(1, Math.max(0, edge[i] - base) / ((1 - base) * BORDER_SHARE)));
    orig.push(i);
    isSep.push(sep[i]);
    pale.push(light[i]);
  };
  for (let i = 0; i < N; i++) {
    if (sep[i]) {
      let j = i;
      while (j + 1 < N && sep[j + 1]) j++;
      if (i > 1 && j < N - 2 && j - i + 1 < maxRun) {
        // The color ramps into and out of the gap go with it.
        let a = i;
        let c = j;
        while (a > done + 1 && i - a < 4 && ramp[a - 1] >= 0.5 && orig[orig.length - 1] === a - 1)
          a--, b.pop(), orig.pop(), isSep.pop(), pale.pop();
        while (c < N - 2 && c - j < 4 && ramp[c + 1] >= 0.5) c++;
        const mid = Math.round((i + j) / 2);
        for (let k = compress ? mid : a; k <= (compress ? mid : c); k++) {
          b.push(k === mid ? 1 : 0);
          orig.push(compress ? (i + j) / 2 : k);
          isSep.push(0);
          pale.push(compress ? 0 : light[k]);
        }
        runs.push([i, j + 1]);
        i = done = c;
        continue;
      }
      // A run that stays is kept whole (not looked at again from inside).
      for (let k = i; k <= j; k++) keep(k);
      i = j;
      continue;
    }
    keep(i);
  }
  return { b: Float64Array.from(b), orig, isSep, pale, runs };
}

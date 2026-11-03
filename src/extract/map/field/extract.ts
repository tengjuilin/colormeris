// Map tool, the value field (pure): the plot area is the panel's grid corners; it is sampled in square bins of
// map.bin rendered pixels (1 = native), each bin the per-channel median of its pixels, read through the
// colorbar. The values (extractFieldValues) depend only on the image, corners, colorbar, settings and bin; the
// coordinates (coords.ts fieldCoords) are added apart, so the Map tool caches the values alone.

import { deltaE76, onWhite } from '../../../core/color.ts';
import { colorAtT } from '../../../core/colorbar.ts';
import { bilinear, gridPixelSize, invertBilinear, readPixel } from '../../../core/grid.ts';
import { medianInPlace } from '../../../core/stats.ts';
import type {
  ColorbarSample,
  Corners,
  ErrorResult,
  MapField,
  MapResult,
  Panel,
  PixelImage,
  Point,
  Rgb,
} from '../../../types/index.ts';
import { colorbarProblem } from '../../project/project.ts';
import { FLAG_DELTA_E, FLAG_HIGH, FLAG_LOW, prepareColorbar } from './color-reader.ts';
import { type FieldCoords, fieldCoords } from './coords.ts';
import { sampleProfiles } from './profiles.ts';

/** The values part of a field (extractFieldValues): everything in MapField but the coordinates. */
export type FieldValues = Omit<MapField, keyof FieldCoords>;

// Above this many values extraction gets slow and CSVs huge; a larger bin
// is the honest answer for such images anyway.
export const MAX_MAP_CELLS = 1_000_000;

export function mapSize(panel: Panel) {
  const { width, height } = gridPixelSize(panel.grid.corners!);
  const bin = Math.max(1, panel.map.bin);
  return { width, height, rows: Math.max(1, Math.round(height / bin)), cols: Math.max(1, Math.round(width / bin)) };
}

export function mapProblem(panel: Panel): string | null {
  if (!panel.grid.corners) return 'Place the plot area.';
  const bar = colorbarProblem(panel);
  if (bar) return bar;
  const { rows, cols } = mapSize(panel);
  if (rows * cols > MAX_MAP_CELLS)
    return `${cols} × ${rows} values is too many; use a larger bin (at most ${MAX_MAP_CELLS.toLocaleString('en-US')} values).`;
  return null;
}

// How many distinct values the sampled colorbar can tell apart: steps between
// neighbouring samples that change the color visibly, plus one.
export function colorbarLevels(samples: ColorbarSample[]) {
  let n = 1;
  for (let i = 1; i < samples.length; i++) if (deltaE76(samples[i - 1].lab, samples[i].lab) > 0.5) n++;
  return n;
}

// The values of the field: {rows, cols, bin, width, height, values, t,
// deltaE, flags (typed arrays, row-major), samples, stats} or {error}.
export function extractFieldValues(img: PixelImage, panel: Panel): FieldValues | ErrorResult {
  const error = mapProblem(panel);
  if (error) return { error };
  const { samples, read } = prepareColorbar(img, panel);
  const { width, height, rows, cols } = mapSize(panel);
  const corners = panel.grid.corners!;
  // Pixels read per bin side: one per pixel of the bin, at least one.
  const nu = Math.max(1, Math.round(width / cols));
  const nv = Math.max(1, Math.round(height / rows));
  const n = rows * cols;
  const values = new Float64Array(n);
  const ts = new Float32Array(n);
  const deltaE = new Float32Array(n);
  const flags = new Uint8Array(n);
  const stats = {
    min: Infinity,
    max: -Infinity,
    flagged: 0,
    clippedLow: 0,
    clippedHigh: 0,
    levels: colorbarLevels(samples),
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rgb = sampleBin(img, corners, (c + 0.5) / cols, (r + 0.5) / rows, 1 / cols, 1 / rows, nu, nv);
      const hit = read(rgb);
      const i = r * cols + c;
      values[i] = hit.value;
      ts[i] = hit.t;
      deltaE[i] = hit.deltaE;
      let f = hit.clip;
      if (hit.deltaE > panel.settings.maxDeltaE) f |= FLAG_DELTA_E;
      flags[i] = f;
      if (f & FLAG_DELTA_E) stats.flagged++;
      if (f & FLAG_LOW) stats.clippedLow++;
      if (f & FLAG_HIGH) stats.clippedHigh++;
      if (hit.value < stats.min) stats.min = hit.value;
      if (hit.value > stats.max) stats.max = hit.value;
    }
  }
  return { rows, cols, bin: panel.map.bin, width, height, values, t: ts, deltaE, flags, samples, stats };
}

// Values plus the coordinates of their bin centres for the panel's axes, units
// and scale bar now. Keys keep extractField's order.
export function withCoords(v: FieldValues, panel: Panel): MapField {
  const c = fieldCoords(panel, v.rows, v.cols);
  return {
    rows: v.rows,
    cols: v.cols,
    bin: v.bin,
    width: v.width,
    height: v.height,
    values: v.values,
    t: v.t,
    deltaE: v.deltaE,
    flags: v.flags,
    xs: c.xs,
    ys: c.ys,
    xAxis: c.xAxis,
    yAxis: c.yAxis,
    xName: c.xName,
    yName: c.yName,
    axisProblems: c.axisProblems,
    samples: v.samples,
    stats: v.stats,
  };
}

// The value field. Result: {rows, cols, bin, width, height, values, t,
// deltaE, flags (typed arrays, row-major), xs, ys (axis values at bin
// centres, or pixel offsets when xAxis/yAxis is false), xAxis, yAxis,
// axisProblems, samples, stats} or {error}.
export function extractField(img: PixelImage, panel: Panel): MapField | ErrorResult {
  const v = extractFieldValues(img, panel);
  return v.error ? v : withCoords(v as FieldValues, panel);
}

// Field and profiles together: extractField() plus {profiles}.
export function extractMap(img: PixelImage, panel: Panel): MapResult {
  return { ...extractField(img, panel), profiles: sampleProfiles(img, panel) };
}

// Per-channel median of nu × nv pixels spread over the bin centred at
// (u, v) of size du × dv. Page points put pixel i at [i, i + 1), as in the
// status bar, so a point is read at p − 0.5. (sampleCell in core/grid.ts
// reads pixel i at i; with full-size bins that reaches half a pixel past
// the plot area.)
// Reused typed buffers (one pass per channel, sorted in place), so reading a
// bin allocates nothing per pixel.
let binBuf = [new Float64Array(0), new Float64Array(0), new Float64Array(0)];
function sampleBin(
  img: PixelImage,
  corners: Corners,
  u: number,
  v: number,
  du: number,
  dv: number,
  nu: number,
  nv: number,
): Rgb {
  if (nu === 1 && nv === 1) {
    const p = bilinear(corners, u, v);
    return readPixel(img, p.x - 0.5, p.y - 0.5);
  }
  const n = nu * nv;
  if (binBuf[0].length < n) binBuf = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  const [r, g, b] = binBuf;
  const [tl, tr, br, bl] = corners;
  const { width: W, height: H, data: d } = img;
  let k = 0;
  for (let j = 0; j < nv; j++) {
    const vv = v + ((j + 0.5) / nv - 0.5) * dv;
    // Along a row of samples the bilinear map is linear in u: left + u * span.
    const lx = tl.x + vv * (bl.x - tl.x);
    const ly = tl.y + vv * (bl.y - tl.y);
    const sx = tr.x + vv * (br.x - tr.x) - lx;
    const sy = tr.y + vv * (br.y - tr.y) - ly;
    for (let i = 0; i < nu; i++, k++) {
      const uu = u + ((i + 0.5) / nu - 0.5) * du;
      // readPixel(img, p.x - 0.5, p.y - 0.5), inlined.
      const xi = Math.min(W - 1, Math.max(0, Math.round(lx + uu * sx - 0.5)));
      const yi = Math.min(H - 1, Math.max(0, Math.round(ly + uu * sy - 0.5)));
      const q = (yi * W + xi) * 4;
      const a = d[q + 3] / 255;
      if (a >= 1) {
        r[k] = d[q];
        g[k] = d[q + 1];
        b[k] = d[q + 2];
      } else {
        r[k] = onWhite(d[q], a);
        g[k] = onWhite(d[q + 1], a);
        b[k] = onWhite(d[q + 2], a);
      }
    }
  }
  return [medianInPlace(r.subarray(0, n)), medianInPlace(g.subarray(0, n)), medianInPlace(b.subarray(0, n))];
}

// RGBA pixels (one per bin) of the reconstruction: each value repainted with
// its colorbar color. Bins share few distinct t (one per distinct color
// read), so each t is converted once; pixels are written as 32-bit words.
export function reconPixels(result: Pick<MapField, 't' | 'samples'>) {
  const out = new Uint8ClampedArray(result.t.length * 4);
  const px = new Uint32Array(out.buffer);
  const word = new Uint8ClampedArray(4);
  const wordView = new Uint32Array(word.buffer);
  const byT = new Map<number, number>();
  for (let i = 0; i < result.t.length; i++) {
    const t = result.t[i];
    let w = byT.get(t);
    if (w === undefined) {
      const [r, g, b] = colorAtT(result.samples, t);
      word[0] = r;
      word[1] = g;
      word[2] = b;
      word[3] = 255;
      w = wordView[0];
      byT.set(t, w);
    }
    px[i] = w;
  }
  return out;
}

// Value under a page point: {row, col, value, deltaE, flags} or null outside.
export function mapAt(result: MapField | ErrorResult | null | undefined, panel: Panel, p: Point) {
  if (!result || result.error || !panel.grid.corners) return null;
  result = result as MapField;
  const { u, v } = invertBilinear(panel.grid.corners, p);
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
  const row = Math.floor(v * result.rows);
  const col = Math.floor(u * result.cols);
  const i = row * result.cols + col;
  return { row, col, value: result.values[i], deltaE: result.deltaE[i], flags: result.flags[i] };
}

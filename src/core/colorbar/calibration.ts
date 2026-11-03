// Colorbar calibration: sample the bar's colors along a line, map positions
// along the bar (t in [0, 1], start → end) to data values via user ticks
// (scales, value functions), and map arbitrary colors back to t by nearest
// perceptual match.
import type {
  Colorbar,
  ColorbarSample,
  ColorbarScale,
  Lab,
  PixelImage,
  Point,
  Rgb,
  TickWithT,
} from '../../types/index.ts';
import { colorDistance, deltaE76, deltaE2000, labToRgb, rgbToLab } from '../color.ts';
import { colormapSamples } from '../colormap-match.ts';
import { readPixel } from '../grid.ts';

export const DEFAULT_SAMPLES = 256;

// Returns [{t, rgb, lab}] sampled evenly from start to end. Each sample is the
// mean over a window of ±halfWidth pixels perpendicular to the bar.
export function sampleColorbar(
  img: PixelImage,
  start: Point,
  end: Point,
  halfWidth = 2,
  n = DEFAULT_SAMPLES,
): ColorbarSample[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [];
  const px = -dy / len;
  const py = dx / len;
  const hw = Math.max(0, Math.round(halfWidth));
  const samples: ColorbarSample[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const cx = start.x + t * dx;
    const cy = start.y + t * dy;
    const sum = [0, 0, 0];
    for (let k = -hw; k <= hw; k++) {
      const [r, g, b] = readPixel(img, cx + k * px, cy + k * py);
      sum[0] += r;
      sum[1] += g;
      sum[2] += b;
    }
    const count = 2 * hw + 1;
    const rgb = sum.map((s) => s / count);
    samples.push({ t, rgb, lab: rgbToLab(rgb) });
  }
  return samples;
}

// Position of point p projected onto the line start → end, as t (unclamped).
export function projectT(start: Point, end: Point, p: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  return ((p.x - start.x) * dx + (p.y - start.y) * dy) / len2;
}

export function pointAtT(start: Point, end: Point, t: number): Point {
  return { x: start.x + t * (end.x - start.x), y: start.y + t * (end.y - start.y) };
}

// Colorbar scales. "linear" and "log10" bars have their ticks on one
// straight line (in log10 for a log bar). "piecewise" bars do not: binned
// bars label bin boundaries with uneven values (1e4, 2e4, 2e5, 5e5 at even
// steps), so values are interpolated between neighbouring ticks only, and
// a check should not expect one line. "piecewise-log10" interpolates in
// log10 between neighbours. The value function is the same for a scale and
// its piecewise twin (it always goes tick to tick); the names tell checks
// and readers what the figure promises.
export const SCALES: ColorbarScale[] = ['linear', 'log10', 'piecewise', 'piecewise-log10'];
export const isLogScale = (scale: string) => scale === 'log10' || scale === 'piecewise-log10';
export const isPiecewiseScale = (scale: string) => scale === 'piecewise' || scale === 'piecewise-log10';

// The piecewise scale for a set of ticks: log10 between neighbours when
// every value is positive and they span at least two decades. Such labels
// (1e3, 2e3, 5e3, 1e4, 1e5) sit on a log-like axis, and a bin's geometric
// middle (6.3e4 for 2e4–2e5) is its middle on that axis; the arithmetic one
// (1.1e5) is not. Values with a 0 or a narrow range (0, 3, … 21) stay linear.
export function piecewiseScaleFor(ticks: { value: number }[]): ColorbarScale {
  const v = ticks.map((k) => k.value).filter(Number.isFinite);
  if (!v.length || v.some((x) => x <= 0)) return 'piecewise';
  return Math.max(...v) / Math.min(...v) >= 100 ? 'piecewise-log10' : 'piecewise';
}

// Validates ticks and returns a problem description, or null when usable.
export function tickProblem(ticks: TickWithT[], scale: string) {
  const valid = ticks.filter((k) => Number.isFinite(k.t) && Number.isFinite(k.value));
  if (valid.length < 2) return 'Add at least two ticks with numeric values.';
  if (isLogScale(scale) && valid.some((k) => k.value <= 0)) return 'Log scale needs positive tick values.';
  const ts = new Set(valid.map((k) => k.t.toFixed(6)));
  if (ts.size < 2) return 'Ticks must be at different positions along the bar.';
  if (isPiecewiseScale(scale)) {
    // Between neighbours only works when values rise (or fall) all along.
    const v = [...valid].sort((a, b) => a.t - b.t).map((k) => k.value);
    const steps = v.slice(1).map((x, i) => Math.sign(x - v[i]));
    if (steps.some((s) => s !== steps[0]) || !steps[0])
      return 'Piecewise scale needs tick values that rise or fall steadily along the bar.';
  }
  return null;
}

// Piecewise-linear t → value through the ticks, extrapolated linearly beyond
// the outermost ticks. With a log scale interpolation happens in log space.
export function makeValueFn(ticks: TickWithT[], scale: string = 'linear'): ((t: number) => number) | null {
  if (tickProblem(ticks, scale)) return null;
  const log = isLogScale(scale);
  const pts = ticks
    .filter((k) => Number.isFinite(k.t) && Number.isFinite(k.value))
    .map((k) => ({ t: k.t, y: log ? Math.log10(k.value) : k.value }))
    .sort((a, b) => a.t - b.t);
  // Collapse ticks at identical positions by averaging.
  const merged: { t: number; y: number; n: number }[] = [];
  for (const p of pts) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.t - p.t) < 1e-9) {
      last.y = (last.y * last.n + p.y) / (last.n + 1);
      last.n++;
    } else merged.push({ ...p, n: 1 });
  }
  return (t: number) => {
    let k = 0;
    while (k < merged.length - 2 && t > merged[k + 1].t) k++;
    const a = merged[k];
    const b = merged[k + 1];
    const y = a.y + ((t - a.t) / (b.t - a.t)) * (b.y - a.y);
    return log ? 10 ** y : y;
  };
}

// The colorbar's samples: from its known colormap when it has one (see
// colormapSamples, imported from core/colormap-match.ts), else
// read from the image along the bar line.
export function colorbarSamples(img: PixelImage, cb: Colorbar) {
  if (cb.colormap) return colormapSamples(cb.colormap, cb.nSamples) || [];
  return sampleColorbar(img, cb.start!, cb.end!, cb.halfWidth, cb.nSamples);
}

// Nearest position along the sampled bar for a Lab color. Refines between the
// best sample and its closer neighbour by projecting in Lab space.
// Returns {t, deltaE}.
export function labToT(lab: Lab, samples: ColorbarSample[], distance = 'de2000'): { t: number; deltaE: number } {
  const dist = colorDistance(distance);
  let best = 0;
  let bestD = Infinity;
  // Exact pruning for CIEDE2000: its lightness term alone is at most
  // dL / 1 and at least dL / 1.75 (Sl ≤ 1.75), and the other terms never
  // make the sum smaller than that (the cross term is dominated), so a
  // sample whose dL / 1.75 already exceeds the best distance cannot win. A
  // ΔE76 seed (the likely winner) makes the bound tight from the start; ties
  // still go to the lowest index, as in a plain scan.
  const prune = dist === deltaE2000 ? 1.75 : 0;
  if (prune) {
    let seed = 0;
    let seedD = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const d = deltaE76(lab, samples[i].lab);
      if (d < seedD) {
        seedD = d;
        seed = i;
      }
    }
    best = seed;
    bestD = dist(lab, samples[seed].lab);
  }
  // ΔE76 is at least |ΔL| (no factor), which prunes the same way without a seed.
  const bound = prune || (dist === deltaE76 ? 1 : 0);
  const L = lab[0];
  for (let i = 0; i < samples.length; i++) {
    if (bound && Math.abs(L - samples[i].lab[0]) > bound * bestD) continue;
    const d = dist(lab, samples[i].lab);
    if (d < bestD || (d === bestD && i < best)) {
      bestD = d;
      best = i;
    }
  }
  let result = { t: samples[best].t, deltaE: bestD };
  for (const j of [best - 1, best + 1]) {
    if (j < 0 || j >= samples.length) continue;
    const a = samples[best].lab;
    const b = samples[j].lab;
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    if (len2 === 0) continue;
    const s = ((lab[0] - a[0]) * ab[0] + (lab[1] - a[1]) * ab[1] + (lab[2] - a[2]) * ab[2]) / len2;
    if (s <= 0 || s >= 1) continue;
    const q = [a[0] + s * ab[0], a[1] + s * ab[1], a[2] + s * ab[2]];
    const d = dist(lab, q);
    if (d < result.deltaE) {
      result = { t: samples[best].t + s * (samples[j].t - samples[best].t), deltaE: d };
    }
  }
  return result;
}

// Interpolated RGB color of the sampled bar at position t (clamped to [0, 1]).
export function colorAtT(samples: ColorbarSample[], t: number): Rgb {
  const n = samples.length;
  if (n === 0) return [0, 0, 0];
  const x = Math.min(1, Math.max(0, t)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  if (n === 1) return samples[0].rgb;
  const f = x - i;
  const a = samples[i].lab;
  const b = samples[i + 1].lab;
  return labToRgb([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])]);
}

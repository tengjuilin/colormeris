import type { CellStatus, ColorBin, Colorbar, ColorbarSample, ColorbarScale, LabelledBin, Lab, OffMapReason, OpenSide, PixelImage, Point, Rgb, TickWithT } from '../types/index.ts';
import { colorDistance, deltaE2000, deltaE76, labToRgb, rgbToLab } from './color.ts';
import { colormapSamples } from './colormap-match.ts';
import { readPixel } from './grid.ts';

// Colorbar calibration: sample the bar's colors along a line, map positions
// along the bar (t in [0, 1], start → end) to data values via user ticks, and
// map arbitrary colors back to t by nearest perceptual match.


export const DEFAULT_SAMPLES = 256;

// Returns [{t, rgb, lab}] sampled evenly from start to end. Each sample is the
// mean over a window of ±halfWidth pixels perpendicular to the bar.
export function sampleColorbar(img: PixelImage, start: Point, end: Point, halfWidth = 2, n = DEFAULT_SAMPLES): ColorbarSample[] {
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
    if (steps.some((s) => s !== steps[0]) || !steps[0]) return 'Piecewise scale needs tick values that rise or fall steadily along the bar.';
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
    return log ? Math.pow(10, y) : y;
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

// ------------------------------------------------------------ binned bars

// A binned (discrete) colorbar is a few flat colors with sharp steps
// between them. Reading a cell's color as the nearest spot on such a bar
// lands anywhere inside a flat bin (in practice near its low end: 1.1e4 in
// the 1e4–2e4 bin of a real figure), so cells are matched to whole bins
// instead and get the bin's middle value.

const BIN_STEP = 3; // smallest ΔE76 step between two samples that ends a bin
const MAX_BINS = 64;

const labMedian = (labs: Lab[]) => [0, 1, 2].map((i) => median(labs.map((l) => l[i])));

// Samples [{t, lab}] → [{t0, t1, lab, rgb}] in order along the bar, or null
// when the bar is not binned. Bins are runs of samples joined by small
// steps; the short runs between them (anti-aliased edges, tick marks drawn
// into the strip) are left out, and a boundary lies halfway across them.
// A smooth bar fails because its runs are not flat (or it is one run).
export function colorbarBins(samples: ColorbarSample[]): ColorBin[] | null {
  const n = samples.length;
  if (n < 16) return null;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push(deltaE76(samples[i].lab, samples[i + 1].lab));
  const noise = median(d);
  const step = Math.max(BIN_STEP, 6 * noise);
  const runs: [number, number][] = [];
  let from = 0;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] <= step) continue;
    runs.push([from, i]);
    from = i + 1;
  }
  runs.push([from, n - 1]);
  const minLen = Math.max(3, Math.round(n * 0.01));
  // Flat: every sample within this of the run's median color. Two similar
  // bins joined by a soft edge spread wider than that and fail the bar.
  const flat = Math.max(2.5, 1.5 + 4 * noise);
  const bins: { i0: number; i1: number; lab: Lab }[] = [];
  let covered = 0;
  for (let [a, b] of runs) {
    if (b - a + 1 < minLen) continue;
    // The bin's color from the middle of the run. JPEG ringing blurs each
    // step over a few samples of small steps, which stay in the run: trim
    // them off its ends (at most a quarter of the run on each side, so a
    // smooth gradient still fails as not flat).
    const len = b - a + 1;
    const lab = labMedian(samples.slice(a + Math.floor(len * 0.2), b + 1 - Math.floor(len * 0.2)).map((s) => s.lab));
    const cut = Math.floor(len / 4);
    const off = (i: number) => deltaE76(samples[i].lab, lab) > flat;
    let a1 = a;
    let b1 = b;
    for (let k = 0; k < cut; k++) {
      if (off(a + k)) a1 = a + k + 1;
      if (off(b - k)) b1 = b - k - 1;
    }
    [a, b] = [a1, b1];
    if (b - a + 1 < minLen) continue;
    for (let i = a; i <= b; i++) if (deltaE76(samples[i].lab, lab) > flat) return null;
    covered += len;
    // A spike inside one bin (a tick mark) splits it in two runs of one color.
    const last = bins[bins.length - 1];
    if (last && deltaE76(last.lab, lab) <= step) {
      last.i1 = b;
      continue;
    }
    bins.push({ i0: a, i1: b, lab });
  }
  if (bins.length < 2 || bins.length > MAX_BINS || covered < 0.75 * n) return null;
  const tOf = (i: number) => samples[i].t;
  return bins.map((bin, k) => ({
    t0: k === 0 ? Math.min(tOf(0), tOf(n - 1)) : (tOf(bins[k - 1].i1) + tOf(bin.i0)) / 2,
    t1: k === bins.length - 1 ? Math.max(tOf(0), tOf(n - 1)) : (tOf(bin.i1) + tOf(bins[k + 1].i0)) / 2,
    lab: bin.lab,
    rgb: labToRgb(bin.lab),
  }));
}

// Bins → bins with {value, open}. A bin's value is the one at its middle
// position, which is the middle of its two boundary ticks in the bar's
// scale (arithmetic on a linear bar, geometric on a log one) when the ticks
// label bin boundaries, and the label itself when they label bin centres.
// Boundaries within a few samples of a tick are moved onto it first, so a
// middle is exact. A bin past the outermost tick on its side is open-ended
// (the bar says "below 1e4" or "above 3e6", not how far): its value is that
// tick's value and `open` is 'below' or 'above'; otherwise open is null.
export function labelBins(bins: ColorBin[] | null, ticks: TickWithT[], scale: string = 'linear', nSamples = DEFAULT_SAMPLES): LabelledBin[] | null {
  const valueAt = makeValueFn(ticks, scale);
  if (!bins || !valueAt) return null;
  const ts = ticks.filter((k) => Number.isFinite(k.t) && Number.isFinite(k.value)).sort((a, b) => a.t - b.t);
  const lo = ts[0];
  const hi = ts[ts.length - 1];
  const minWidth = Math.min(...bins.map((b) => b.t1 - b.t0));
  const tol = Math.max(2 / Math.max(1, nSamples - 1), 0.25 * minWidth);
  const snap = (t: number) => {
    let best = t;
    let gap = tol;
    for (const k of ts) {
      if (Math.abs(k.t - t) > gap) continue;
      gap = Math.abs(k.t - t);
      best = k.t;
    }
    return best;
  };
  // Which way values go past a tick: up when the bar's values grow towards it.
  const past = (tick: TickWithT, inner: number): OpenSide => (valueAt(tick.t) >= valueAt(inner) ? 'above' : 'below');
  return bins.map((bin, i) => {
    const t0 = snap(bin.t0);
    const t1 = snap(bin.t1);
    if (t0 >= hi.t - tol && hi.t < 1 - tol) return { ...bin, t0, t1, value: hi.value, open: past(hi, lo.t) };
    if (t1 <= lo.t + tol && lo.t > tol) return { ...bin, t0, t1, value: lo.value, open: past(lo, hi.t) };
    return { ...bin, t0, t1, value: valueAt((t0 + t1) / 2), open: null };
  });
}

// Index of the bin nearest to a Lab color, with its distance.
export function nearestBin(lab: Lab, bins: ColorBin[], distance = 'de2000') {
  const dist = colorDistance(distance);
  let best = { index: 0, deltaE: Infinity };
  bins.forEach((b, index) => {
    const d = dist(lab, b.lab);
    if (d < best.deltaE) best = { index, deltaE: d };
  });
  return best;
}

// ------------------------------------------------------- off-map colors

// A cell's color may not be on the colormap at all: gray "ND" (no data)
// cells, a black diagonal, a hatched or masked cell. Its nearest bar color
// is then meaningless, and with a close-enough lightness the distance can
// even stay under the flag threshold (a gray cell read as pale blue at
// ΔE2000 7.2). Cells past an end of the bar are different: the figure drew
// values beyond its colorbar, along the bar's own color path (paler than a
// pale end, darker than a dark one); they clamp to that end.

const GRAY = 8; // chroma under which a color counts as neutral
const GRAY_L = 8; // lightness gap within which a neutral bar color vouches for a neutral cell
const END_ZONE = 0.04; // share of the bar at each end where a past-end match lands
const OFF_MAP_FACTOR = 2; // ΔE over this × maxDeltaE: off the map whatever its hue
const HUE_LIMIT = 45; // hue difference (degrees) between two colorful colors that rules a match out

const hueOf = (lab: Lab) => (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
const hueGap = (a: Lab, b: Lab) => {
  const h = Math.abs(hueOf(a) - hueOf(b)) % 360;
  return h > 180 ? 360 - h : h;
};
const labMean = (labs: Lab[]) => [0, 1, 2].map((i) => labs.reduce((s, l) => s + l[i], 0) / labs.length);

// Same color family as a bar end: both near neutral, or close in hue. A
// whitish cell past a pale end also counts (colors fade to white).
function sameFamily(lab: Lab, endLab: Lab, lighter: boolean) {
  const c = chroma(lab);
  const ce = chroma(endLab);
  if (ce < GRAY + 4) return c < ce + GRAY;
  if (lighter && c < GRAY) return true;
  return hueGap(lab, endLab) < 35 && (lighter || c >= 0.4 * ce);
}

// Is the color past the bar end that its match `t` lies at? Either it
// lies ahead on the bar's path into that end (from 6–10% inside to the
// last 3%, extended), within a tolerance that grows with the distance
// (paths curve), or it is lighter or darker than the whole bar. Both need
// the end's color family, and at least 3 ΔE76 past the end: a cell that
// matches the end color is on the bar. Ends are medians, as the last
// sample often holds an anti-aliased edge or the bar's frame, which would
// turn the path around. Flat ends (binned bars) have no path and use only
// the lightness rule. Returns 'start', 'end' or null.
function pastEndOf(lab: Lab, t: number, samples: ColorbarSample[], tol: number): 'start' | 'end' | null {
  const n = samples.length;
  const take = (a: number, b: number) => samples.slice(Math.max(0, a), Math.max(Math.max(0, a) + 1, b)).map((s) => s.lab);
  const Ls = samples.map((s) => s.lab[0]);
  const w = Math.max(1, Math.round(n * 0.03));
  const inA = Math.round(n * 0.06);
  const inB = Math.max(inA + 1, Math.round(n * 0.1));
  for (const side of ['start', 'end'] as const) {
    if (side === 'start' ? t > END_ZONE : t < 1 - END_ZONE) continue;
    const E = labMedian(side === 'start' ? take(0, w) : take(n - w, n));
    const I = labMedian(side === 'start' ? take(inA, inB) : take(n - inB, n - inA));
    const lighter = lab[0] > E[0];
    if (deltaE76(lab, E) < 3 || !sameFamily(lab, E, lighter)) continue;
    const beyond = lighter ? lab[0] > Math.max(...Ls) + 3 : lab[0] < Math.min(...Ls) - 3;
    if (beyond) return side;
    const v = [E[0] - I[0], E[1] - I[1], E[2] - I[2]];
    const v2 = v[0] ** 2 + v[1] ** 2 + v[2] ** 2;
    if (v2 < 9) continue;
    const off = [lab[0] - E[0], lab[1] - E[1], lab[2] - E[2]];
    const s = (off[0] * v[0] + off[1] * v[1] + off[2] * v[2]) / v2;
    const along = s * Math.sqrt(v2);
    const perp = Math.hypot(off[0] - s * v[0], off[1] - s * v[1], off[2] - s * v[2]);
    if (along >= 3 && perp <= tol / 2 + 0.5 * along) return side;
  }
  return null;
}

/** colorStatus' answer: `end` for 'clamped', `reason` for 'off-map'. */
export interface ColorStatus {
  status: CellStatus;
  end?: 'start' | 'end';
  reason?: OffMapReason;
}

/** refineColorbar's answer. */
export interface RefinedColorbar {
  start: Point;
  end: Point;
  halfWidth: number;
  stripHalf: number;
  found: { start: boolean; end: boolean };
  moved: { sideways: number; start: number; end: number };
}

// Where a cell color stands against the bar, given its match {t, deltaE}
// (from labToT, or a bin's t and distance). Returns {status, end?, reason?}:
// 'ok' or 'flagged' (deltaE over maxDeltaE, still read from the bar);
// 'clamped' past an end ('start' or 'end'), read as that end; or 'off-map'
// (not a colormap color, no value), with reason 'gray' (a neutral color
// where the bar has no neutral color of about its lightness: judged
// against the bar's own chroma, so a grayscale or white-ended bar keeps
// its grays or near-white cells),
// 'hue' (both colorful, hues 45° or more apart) or 'far' (ΔE over twice
// maxDeltaE). The ΔE between maxDeltaE and twice it is left as flagged:
// such cells are often mixed colors at cell edges, which still say roughly
// where on the bar they belong.
export function colorStatus(lab: Lab, match: { t: number; deltaE: number; lab?: Lab }, samples: ColorbarSample[], maxDeltaE = 10): ColorStatus {
  if (!samples.length) return { status: 'ok' };
  // A color as close to the bar as this is on it, even past the median end
  // color (a bar that keeps darkening into its last sample).
  const end = match.deltaE > 2 && pastEndOf(lab, match.t, samples, maxDeltaE);
  if (end) return { status: 'clamped', end };
  const i = Math.round(Math.min(1, Math.max(0, match.t)) * (samples.length - 1));
  const near = match.lab || samples[i].lab;
  const c = chroma(lab);
  const cn = chroma(near);
  // A neutral color is on the map only where the bar is neutral at about
  // its lightness (a gray or white-ended bar). ΔE2000 forgives lightness
  // near white, so a mid gray can match a diverging bar's white middle.
  // "Neutral" scales with the cell's own chroma: test-9's RdBu bar has a
  // pale cyan of chroma 7 at the L* of its gray ND cells (chroma 0).
  const neutralAt = (L: number) => samples.some((x) => chroma(x.lab) < 2 * c + 4 && Math.abs(x.lab[0] - L) <= GRAY_L);
  if (c < GRAY && !neutralAt(lab[0])) return { status: 'off-map', reason: 'gray' };
  if (c > 15 && cn > 15 && hueGap(lab, near) > HUE_LIMIT) return { status: 'off-map', reason: 'hue' };
  if (match.deltaE > OFF_MAP_FACTOR * maxDeltaE) return { status: 'off-map', reason: 'far' };
  return { status: match.deltaE > maxDeltaE ? 'flagged' : 'ok' };
}

// ---------------------------------------------------------------- snapping

// An LLM reading coordinates off images places the colorbar and its ticks
// a few pixels off: the line drifts towards the strip's edge, the ends land
// on the outline or short of the last color, and ticks miss their marks.
// These functions find the real strip and tick marks near a rough
// placement. Color steps are ΔE76 in CIELAB.

const SIDE_EDGE = 15; // sideways step that counts as leaving the strip
const MAX_SIDE = 60; // widest half-strip searched, in pixels
const labAt = (img: PixelImage, p: Point) => rgbToLab(readPixel(img, p.x, p.y));
const chroma = (lab: Lab) => Math.hypot(lab[1], lab[2]);
const median = (v: ArrayLike<number>) => {
  const s = Array.from(v).sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function axes(start: Point, end: Point) {
  const len = Math.hypot(end.x - start.x, end.y - start.y);
  const u = { x: (end.x - start.x) / len, y: (end.y - start.y) / len };
  const n = { x: -u.y, y: u.x };
  // Page point at s pixels along the bar from start and k pixels across it.
  const at = (s: number, k = 0): Point => ({ x: start.x + s * u.x + k * n.x, y: start.y + s * u.y + k * n.y });
  return { len, u, n, at };
}

// How far the strip reaches on each side of the line (last pixel that still
// has the line's color), as medians over the middle of the bar. A colorbar
// has one color across its width, so the first big sideways step is its edge.
function stripSides(img: PixelImage, start: Point, end: Point) {
  const { len, at } = axes(start, end);
  const lo: number[] = [];
  const hi: number[] = [];
  const centre: Lab[] = [];
  for (let i = 0; i < 15; i++) {
    const s = len * (0.2 + (0.6 * i) / 14);
    const c = labAt(img, at(s));
    centre.push(c);
    const reach = (dir: number) => {
      let k = 0;
      while (k < MAX_SIDE && deltaE76(labAt(img, at(s, dir * (k + 1))), c) < SIDE_EDGE) k++;
      return k;
    };
    lo.push(reach(-1));
    hi.push(reach(1));
  }
  // A colorbar changes color along its length; a flat line is not on one.
  let spread = 0;
  for (const c of centre) spread = Math.max(spread, deltaE76(c, centre[0]));
  return { lo: median(lo), hi: median(hi), spread };
}

// Rough colorbar line → the strip's centre line with both ends on its last
// colored pixels. Returns {start, end, halfWidth (for sampling), stripHalf,
// found: {start, end}, moved: {sideways, start, end}} or null when no strip
// is found under the line (the rough placement is then kept).
export function refineColorbar(img: PixelImage, start: Point, end: Point): RefinedColorbar | null {
  // Figure colorbars are horizontal or vertical: a line tilted by a few
  // degrees would drift towards one side, so straighten it about its middle.
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < 0.07 * Math.abs(dy)) {
    const mx = (start.x + end.x) / 2;
    [start, end] = [{ x: mx, y: start.y }, { x: mx, y: end.y }];
  } else if (Math.abs(dy) < 0.07 * Math.abs(dx)) {
    const my = (start.y + end.y) / 2;
    [start, end] = [{ x: start.x, y: my }, { x: end.x, y: my }];
  }
  const rough = axes(start, end);
  if (rough.len < 10) return null;
  const { lo, hi, spread } = stripSides(img, start, end);
  if (spread < 10 || lo + hi < 2 || lo >= MAX_SIDE || hi >= MAX_SIDE) return null;
  const shift = (hi - lo) / 2;
  const half = (hi + lo) / 2;
  const s0 = rough.at(0, shift);
  const { len, u, at } = axes(s0, rough.at(rough.len, shift));
  const on = (s: number) => labAt(img, at(s));

  // Steps along the bar inside it; an end is a step much bigger than these.
  const steps: number[] = [];
  for (let s = Math.round(len * 0.3); s < len * 0.7; s++) steps.push(deltaE76(on(s), on(s + 1)));
  const jump = Math.max(12, 5 * median(steps));
  const W = Math.max(8, Math.min(Math.round(len * 0.12), Math.floor(len * 0.35)));
  const out = half + 3;

  // Walk outward across the rough end (s0 along the bar, dir ±1). The end is
  // the first big step, from the inside out, into something that looks like
  // the surroundings (the outline or background beside the strip, or a gray).
  function findEnd(sEnd: number, dir: number) {
    for (let j = -W + 1; j <= W; j++) {
      const prev = on(sEnd + dir * (j - 1));
      const cur = on(sEnd + dir * j);
      const d = deltaE76(prev, cur);
      if (d <= jump) continue;
      const s = sEnd + dir * (j + 1);
      const past = on(s);
      const side = Math.min(deltaE76(past, labAt(img, at(s, -out))), deltaE76(past, labAt(img, at(s, out))));
      if (side >= SIDE_EDGE * 1.5 && chroma(past) >= 8) continue; // an inner step (e.g. a discrete bar)
      // Last clean pixel: step back over an anti-aliased edge pixel, then one more.
      let e = j - 1;
      for (let k = 0; k < 2 && deltaE76(on(sEnd + dir * (e - 1)), on(sEnd + dir * e)) > 0.3 * d; k++) e--;
      return sEnd + dir * (e - 1);
    }
    return null;
  }
  const sStart = findEnd(0, -1);
  const sEnd = findEnd(len, 1);
  const a = sStart ?? 0;
  const b = sEnd ?? len;
  if (b - a < Math.max(5, len * 0.5)) return null;
  const r = (v: number) => Math.round(v * 10) / 10;
  const p = (s: number) => ({ x: r(at(s).x), y: r(at(s).y) });
  return {
    start: p(a),
    end: p(b),
    // Sample the middle half of the strip, away from its anti-aliased sides.
    halfWidth: Math.max(0, Math.min(6, Math.floor(half / 2))),
    stripHalf: half,
    found: { start: sStart !== null, end: sEnd !== null },
    moved: { sideways: r(shift), start: r(-a), end: r(b - len) },
  };
}

// Tick mark nearest `at` on a colorbar (start → end on the strip's centre
// line). Marks are short lines across the bar's edge: outside it (dark on
// the background) or drawn into the strip from its edge (off the strip's
// color there). Returns {t, moved (pixels along the bar), point} or null
// when no clear mark is near.
export function snapTick(img: PixelImage, start: Point, end: Point, at: Point): { t: number; moved: number; point: Point } | null {
  const { len, u, at: pt } = axes(start, end);
  if (len < 10) return null;
  const s0 = (at.x - start.x) * u.x + (at.y - start.y) * u.y;
  const W = Math.max(4, Math.round(len * 0.04));
  const from = Math.round(s0 - W - 4);
  const to = Math.round(s0 + W + 4);
  const { lo, hi } = stripSides(img, start, end);
  const bands: { ks: number[]; min: number; outside: boolean }[] = [];
  for (const [dir, edge] of [[-1, lo], [1, hi]]) {
    if (edge >= MAX_SIDE) continue;
    const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => dir * (a + i));
    // Outside: the background dominates the band, marks stand out from it.
    bands.push({ ks: range(edge + 2, edge + 9), min: 3, outside: true });
    // Inside: the strip has one color across, so a mark differs from the centre.
    if (edge >= 3) bands.push({ ks: range(Math.max(1, edge - 6), edge), min: 2, outside: false });
  }
  let best: number | null = null;
  for (const band of bands) {
    const rows: Lab[][] = [];
    for (let s = from; s <= to; s++) rows.push(band.ks.map((k) => labAt(img, pt(s, k))));
    let refAt: (i: number) => Lab;
    if (band.outside) {
      const ref = [0, 1, 2].map((i) => median(rows.flat().map((l) => l[i])));
      refAt = () => ref;
    } else refAt = (i: number) => labAt(img, pt(from + i, 0));
    const limit = band.outside ? 25 : 20;
    const profile = rows.map((row, i) => row.filter((l) => deltaE76(l, refAt(i)) > limit).length);
    const base = median(profile);
    // Runs of positions where the band holds a mark; marks are thin.
    let run: { from: number; to: number; sum: number; weight: number } | null = null;
    const flush = () => {
      if (!run) return;
      const centre = run.sum / run.weight;
      if (run.to - run.from < 8 && Math.abs(centre - s0) <= W && (!best || Math.abs(centre - s0) < Math.abs(best - s0))) best = centre;
      run = null;
    };
    profile.forEach((v, i) => {
      const x = v - base;
      if (x < band.min) return flush();
      const s = from + i;
      run ??= { from: s, to: s, sum: 0, weight: 0 };
      run.to = s;
      run.sum += s * x;
      run.weight += x;
    });
    flush();
  }
  if (best === null) return null;
  return { t: best / len, moved: Math.round((best - s0) * 10) / 10, point: pt(best) };
}

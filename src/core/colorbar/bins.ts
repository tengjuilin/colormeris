// Binned (discrete) colorbars: finding the flat bins of a sampled bar,
// labelling them with values from the ticks, and the nearest bin of a color.
import type { ColorBin, ColorbarSample, Lab, LabelledBin, OpenSide, TickWithT } from '../../types/index.ts';
import { colorDistance, deltaE76, labToRgb } from '../color.ts';
import { median } from '../stats.ts';
import { DEFAULT_SAMPLES, makeValueFn } from './calibration.ts';

// A binned (discrete) colorbar is a few flat colors with sharp steps
// between them. Reading a cell's color as the nearest spot on such a bar
// lands anywhere inside a flat bin (in practice near its low end: 1.1e4 in
// the 1e4–2e4 bin of a real figure), so cells are matched to whole bins
// instead and get the bin's middle value.

const BIN_STEP = 3; // smallest ΔE76 step between two samples that ends a bin
const MAX_BINS = 64;

/** Per-channel median of Lab colors (also status.ts' bar ends). */
export const labMedian = (labs: Lab[]) => [0, 1, 2].map((i) => median(labs.map((l) => l[i])));

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
export function labelBins(
  bins: ColorBin[] | null,
  ticks: TickWithT[],
  scale: string = 'linear',
  nSamples = DEFAULT_SAMPLES,
): LabelledBin[] | null {
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
  return bins.map((bin) => {
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

// Where a cell's color stands against the bar: on it, flagged, clamped past
// an end, or off the map (gray, another hue, too far).
import type { CellStatus, ColorbarSample, Lab, OffMapReason } from '../../types/index.ts';
import { chroma, deltaE76, hueAngle } from '../color.ts';
import { labMedian } from './bins.ts';

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
const COLORFUL = 15; // chroma over which a hue is reliable enough to compare
const ON_BAR_DE = 2; // ΔE to the bar under which a color is on it, whatever the end rules say
// pastEndOf: a color must be this far (ΔE76) from the end color to be past
// it, and this much lighter or darker than the whole bar to be past it by
// lightness alone; anything closer is the end color with noise.
const PAST_END_DE = 3;
// pastEndOf's end path: the end color is the median of the last END_SHARE of
// the bar, the inner point the median of INNER_FROM to INNER_TO inside it.
// Ends are medians: the last sample often holds an anti-aliased edge or frame.
const END_SHARE = 0.03;
const INNER_FROM = 0.06;
const INNER_TO = 0.1;
const SAME_HUE = 35; // hue gap (degrees) within which a color is in an end's family

const hueGap = (a: Lab, b: Lab) => {
  const h = Math.abs(hueAngle(a) - hueAngle(b)) % 360;
  return h > 180 ? 360 - h : h;
};

// Same color family as a bar end: both near neutral, or close in hue. A
// whitish cell past a pale end also counts (colors fade to white).
function sameFamily(lab: Lab, endLab: Lab, lighter: boolean) {
  const c = chroma(lab);
  const ce = chroma(endLab);
  if (ce < GRAY + 4) return c < ce + GRAY;
  if (lighter && c < GRAY) return true;
  return hueGap(lab, endLab) < SAME_HUE && (lighter || c >= 0.4 * ce);
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
  const take = (a: number, b: number) =>
    samples.slice(Math.max(0, a), Math.max(Math.max(0, a) + 1, b)).map((s) => s.lab);
  const Ls = samples.map((s) => s.lab[0]);
  const w = Math.max(1, Math.round(n * END_SHARE));
  const inA = Math.round(n * INNER_FROM);
  const inB = Math.max(inA + 1, Math.round(n * INNER_TO));
  for (const side of ['start', 'end'] as const) {
    if (side === 'start' ? t > END_ZONE : t < 1 - END_ZONE) continue;
    const E = labMedian(side === 'start' ? take(0, w) : take(n - w, n));
    const I = labMedian(side === 'start' ? take(inA, inB) : take(n - inB, n - inA));
    const lighter = lab[0] > E[0];
    if (deltaE76(lab, E) < PAST_END_DE || !sameFamily(lab, E, lighter)) continue;
    const beyond = lighter ? lab[0] > Math.max(...Ls) + PAST_END_DE : lab[0] < Math.min(...Ls) - PAST_END_DE;
    if (beyond) return side;
    const v = [E[0] - I[0], E[1] - I[1], E[2] - I[2]];
    const v2 = v[0] ** 2 + v[1] ** 2 + v[2] ** 2;
    if (v2 < PAST_END_DE ** 2) continue; // a flat end (binned bar) has no path
    const off = [lab[0] - E[0], lab[1] - E[1], lab[2] - E[2]];
    const s = (off[0] * v[0] + off[1] * v[1] + off[2] * v[2]) / v2;
    const along = s * Math.sqrt(v2);
    const perp = Math.hypot(off[0] - s * v[0], off[1] - s * v[1], off[2] - s * v[2]);
    if (along >= PAST_END_DE && perp <= tol / 2 + 0.5 * along) return side;
  }
  return null;
}

/** colorStatus' answer: `end` for 'clamped', `reason` for 'off-map'. */
export interface ColorStatus {
  status: CellStatus;
  end?: 'start' | 'end';
  reason?: OffMapReason;
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
export function colorStatus(
  lab: Lab,
  match: { t: number; deltaE: number; lab?: Lab },
  samples: ColorbarSample[],
  maxDeltaE = 10,
): ColorStatus {
  if (!samples.length) return { status: 'ok' };
  // A color as close to the bar as this is on it, even past the median end
  // color (a bar that keeps darkening into its last sample).
  const end = match.deltaE > ON_BAR_DE && pastEndOf(lab, match.t, samples, maxDeltaE);
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
  if (c > COLORFUL && cn > COLORFUL && hueGap(lab, near) > HUE_LIMIT) return { status: 'off-map', reason: 'hue' };
  if (match.deltaE > OFF_MAP_FACTOR * maxDeltaE) return { status: 'off-map', reason: 'far' };
  return { status: match.deltaE > maxDeltaE ? 'flagged' : 'ok' };
}

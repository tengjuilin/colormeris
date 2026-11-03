// Map tool, profiles (pure): values along a profile line, what profiles are measured against (axis, scale-bar
// length or pixels), their length, normalising them for comparison, and pasting copies into a panel.
import { sampleColorbar } from '../../../core/colorbar.ts';
import { bilinear, invertBilinear } from '../../../core/grid.ts';
import type {
  Corners,
  ErrorResult,
  MapUnits,
  Panel,
  PixelImage,
  Point,
  Profile,
  ProfileSample,
} from '../../../types/index.ts';
import { colorbarProblem, createProfile } from '../../project/project.ts';
import { prepareColorbar } from './color-reader.ts';
import { type AxisKey, axisCoords, axisFn, lengthPerPixel } from './coords.ts';

/** What profiles are plotted and measured against (profileXKind): an axis, scale-bar lengths or pixels. */
export type ProfileXKind = AxisKey | 'length' | 'px';

// The axis a profile is plotted and measured against: 'x' or 'y' when the
// line runs mostly along that axis and it is calibrated, else null (distance
// along the line in pixels).
export function profileAxisKey(panel: Panel, profile: Profile): AxisKey | null {
  if (!panel.grid.corners) return null;
  const horizontal = Math.abs(profile.b.x - profile.a.x) >= Math.abs(profile.b.y - profile.a.y);
  const key = horizontal ? 'x' : 'y';
  return axisFn(panel, key).fn ? key : null;
}

// What a profile is plotted and measured against, for the user's choice
// ('axis' | 'px' | 'length'): 'x' or 'y' (axis values), 'length' (distance
// along the line in scale-bar units) or 'px'. A choice that is not
// available falls back to the axis, then the length, then pixels.
export function profileXKind(panel: Panel, profile: Profile, choice: MapUnits = panel.map.units): ProfileXKind {
  if (choice === 'px') return 'px';
  const scaled = lengthPerPixel(panel.scale) !== null;
  if (choice === 'length' && scaled) return 'length';
  return profileAxisKey(panel, profile) || (scaled ? 'length' : 'px');
}

// Length of a profile in the units of profileXKind(): the span of axis
// values between its ends, the real length, or pixels. {length, kind}.
export function profileLength(panel: Panel, profile: Profile, choice?: MapUnits) {
  const kind = profileXKind(panel, profile, choice);
  const px = Math.hypot(profile.b.x - profile.a.x, profile.b.y - profile.a.y);
  if (kind === 'px') return { length: px, kind };
  if (kind === 'length') return { length: px * (lengthPerPixel(panel.scale) as number), kind };
  return {
    length: Math.abs((axisCoords(panel, profile.b)[kind] as number) - (axisCoords(panel, profile.a)[kind] as number)),
    kind,
  };
}

// The end point that gives a profile `length` (in profileLength() units),
// keeping its start and direction; null when no point along it does.
export function profileEndForLength(panel: Panel, profile: Profile, length: number, choice?: MapUnits): Point | null {
  const { a, b } = profile;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(length > 0) || len < 1e-9) return null;
  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const at = (s: number) => ({ x: a.x + s * dir.x, y: a.y + s * dir.y });
  const kind = profileXKind(panel, profile, choice);
  if (kind === 'px') return at(length);
  if (kind === 'length') return at(length / (lengthPerPixel(panel.scale) as number));
  // Axis values are monotonic along the line (also on a log axis), so
  // bisect on the distance in pixels.
  const v0 = axisCoords(panel, a)[kind] as number;
  const span = (s: number) => Math.abs((axisCoords(panel, at(s))[kind] as number) - v0);
  let hi = len;
  for (let k = 0; k < 40 && span(hi) < length; k++) hi *= 2;
  if (!(span(hi) >= length)) return null;
  let lo = 0;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (span(mid) < length) lo = mid;
    else hi = mid;
  }
  return at(hi);
}

// What a profile's values are divided by to compare profiles by shape:
// their maximum or mean (mode 'max' | 'mean') inside the plot area, 1 for 'raw'. {divisor} or
// {error} when it is not positive (dividing would flip or blow up the line).
export function profileDivisor(
  samples: ProfileSample[],
  mode: string,
): { divisor: number; error?: never } | ErrorResult {
  if (mode !== 'max' && mode !== 'mean') return { divisor: 1 };
  const values = samples
    .filter((s) => !s.outside)
    .map((s) => s.value)
    .filter(Number.isFinite);
  const d = mode === 'max' ? Math.max(...values) : values.reduce((a, v) => a + v, 0) / values.length;
  return d > 0 ? { divisor: d } : { error: `The ${mode} is not positive, so the profile cannot be divided by it.` };
}

// Copies of copied profiles for pasting into panel. Between panels with plot
// areas a copy keeps its place within the plot (fromCorners → the panel's
// corners); otherwise it keeps its page position, shifted by offset {x, y}.
// Names already in the panel get a number: "Profile 1 (2)".
export function pastedProfiles(
  panel: Panel,
  profiles: Profile[],
  fromCorners: Corners | null | undefined,
  offset = { x: 0, y: 0 },
) {
  const to = panel.grid.corners;
  const move =
    fromCorners && to && !samePoints(fromCorners, to)
      ? (p: Point) => {
          const { u, v } = invertBilinear(fromCorners, p);
          return bilinear(to, u, v);
        }
      : (p: Point) => ({ x: p.x + offset.x, y: p.y + offset.y });
  const used = new Set(panel.map.profiles.map((l) => l.name));
  return profiles.map((l) => {
    let name = l.name;
    for (let n = 2; used.has(name); n++) name = `${l.name} (${n})`;
    used.add(name);
    return createProfile(move(l.a), move(l.b), { name, halfWidth: l.halfWidth });
  });
}

const samePoints = (a: Point[], b: Point[]) =>
  a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-9 && Math.abs(p.y - b[i].y) < 1e-9);

// Values along a profile line, one sample per pixel of length, each averaged
// over ±halfWidth pixels across the line. Returns
// [{d, len, x, y, px, py, value, deltaE, flagged, clipped, outside}] or
// {error}; d is the distance from the start in pixels, len the same in
// scale-bar units (null without a scale bar).
// Samples outside the plot area (axes, labels, the page) are kept, so the
// line keeps its length, but marked outside: plots and CSVs leave them out.
export function sampleProfile(img: PixelImage, panel: Panel, profile: Profile): ProfileSample[] | ErrorResult {
  const bar = colorbarProblem(panel);
  if (bar) return { error: bar };
  const { a, b } = profile;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 1) return { error: 'Profile is too short.' };
  const { read } = prepareColorbar(img, panel);
  const n = Math.round(length) + 1;
  // Page points put pixel i at [i, i + 1), as in the status bar; the
  // colorbar sampler reads pixel i at i.
  const line = sampleColorbar(
    img,
    { x: a.x - 0.5, y: a.y - 0.5 },
    { x: b.x - 0.5, y: b.y - 0.5 },
    profile.halfWidth,
    n,
  );
  const x = panel.grid.corners ? axisFn(panel, 'x').fn : null;
  const y = panel.grid.corners ? axisFn(panel, 'y').fn : null;
  const perPx = lengthPerPixel(panel.scale);
  return line.map((s) => {
    const hit = read(s.rgb);
    const p = { x: a.x + s.t * (b.x - a.x), y: a.y + s.t * (b.y - a.y) };
    let ax: number | null = null;
    let ay: number | null = null;
    let outside = false;
    if (panel.grid.corners) {
      const { u, v } = invertBilinear(panel.grid.corners, p);
      if (x) ax = x(u);
      if (y) ay = y(v);
      outside = !(u >= -1e-9 && u <= 1 + 1e-9 && v >= -1e-9 && v <= 1 + 1e-9);
    }
    return {
      d: s.t * length,
      len: perPx === null ? null : s.t * length * perPx,
      x: ax,
      y: ay,
      px: p.x,
      py: p.y,
      value: hit.value,
      deltaE: hit.deltaE,
      flagged: hit.deltaE > panel.settings.maxDeltaE,
      clipped: hit.clip !== 0,
      outside,
    };
  });
}

// profile id → sampleProfile(). Profiles only need the colorbar, so they are
// read even without a plot area.
export function sampleProfiles(img: PixelImage, panel: Panel) {
  return Object.fromEntries(panel.map.profiles.map((l) => [l.id, sampleProfile(img, panel, l)]));
}

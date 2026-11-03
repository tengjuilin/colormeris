import { labToRgb } from '../core/color.ts';
import { mapColors } from '../core/colormap-library.ts';
import { lightness } from '../core/cvd.ts';
import type { ColormapEntry, Rgb, ViewData, ViewKey } from '../types/index.ts';
import type { ColormapMetrics, MapFeatures } from './metrics.ts';
import { colormapMetrics, mapFeatures, ratingNotes } from './metrics.ts';

// Pure, cached data about each colormap: parsed colors, the colors in each
// view (as seen, three CVD simulations, grayscale), the rating metrics and
// notes. Colormap data never changes, so the caches live at module level and
// are keyed by map name. Anything that depends on the viewer's state (which
// way a map runs in Browse) takes it as an argument.

/** The part of the viewer's state that decides a map's direction in Browse. */
export interface DirectionState {
  reversed: boolean;
  flipped: ReadonlySet<string>;
}

/** A map's direction in Browse: its own toggle, then the global Reversed. */
export const isRev = (state: DirectionState, name: string): boolean => state.reversed !== state.flipped.has(name);

const featuresOf = new Map<string, MapFeatures>();
const viewsOf = new Map<string, ViewData>(); // `${name}|${view}|${reversed}`
const metricsOf = new Map<string, ColormapMetrics>();
const notesCache = new Map<string, ReturnType<typeof ratingNotes>>();

/** The map's original colors, parsed once (the library's shared array). */
export const base: (map: ColormapEntry) => Rgb[] = mapColors;

/**
 * One record per map: Lab as seen and the CVD simulations with their Lab.
 * The views (viewData) and the ratings (metrics) both read it, so each color
 * is simulated and converted once, whichever the viewer asks for first.
 */
function features(map: ColormapEntry): MapFeatures {
  let f = featuresOf.get(map.name);
  if (!f) featuresOf.set(map.name, (f = mapFeatures(base(map))));
  return f;
}

// A view in the map's own direction. Simulated and gray colors are whole
// bytes already (linearToSrgb rounds and clips), so they need no rounding.
function forwardView(map: ColormapEntry, view: ViewKey): ViewData {
  const f = features(map);
  if (view === 'orig') return { colors: base(map), L: f.labs.map((l) => l[0]) };
  if (view === 'gray') {
    // grayscale(c): the gray of the same L*, which the record already has.
    const colors = f.labs.map((l) => labToRgb([l[0], 0, 0]));
    return { colors, L: colors.map(lightness) };
  }
  const v = f.cvd[view];
  return { colors: v.rgbs, L: v.labs.map((l) => l[0]) };
}

/** The colors of one view, with their lightness. Reversed is the forward view read backwards. */
export function viewData(map: ColormapEntry, view: ViewKey, reversed: boolean): ViewData {
  const key = `${map.name}|${view}|${reversed}`;
  let v = viewsOf.get(key);
  if (!v) {
    if (reversed) {
      const fwd = viewData(map, view, false);
      v = { colors: fwd.colors.slice().reverse(), L: fwd.L!.slice().reverse() };
    } else v = forwardView(map, view);
    viewsOf.set(key, v);
  }
  return v;
}

/** The rating metrics, computed once per map on the original colors. */
export function metrics(map: ColormapEntry): ColormapMetrics {
  let m = metricsOf.get(map.name);
  if (!m) {
    m = colormapMetrics(base(map), { kind: map.kind, cyclic: map.group === 'cyclic' }, features(map));
    metricsOf.set(map.name, m);
  }
  return m;
}

/** The rating notes (one per rating column that applies). */
export function notesOf(map: ColormapEntry) {
  let n = notesCache.get(map.name);
  if (!n) {
    n = ratingNotes(metrics(map), { qual: map.kind === 'qualitative' });
    notesCache.set(map.name, n);
  }
  return n;
}

/** Smallest separation in one view, with positions that follow the direction `reversed`. */
export function sepOf(map: ColormapEntry, key: string, reversed: boolean) {
  const s = (metrics(map).separations as Record<string, { min: number; t: number[] } | null | undefined>)[key];
  if (!s || !reversed) return s;
  if (map.kind === 'qualitative') {
    const n = base(map).length;
    return { min: s.min, t: [n - 1 - s.t[1], n - 1 - s.t[0]] };
  }
  return { min: s.min, t: [1 - s.t[1], 1 - s.t[0]] };
}

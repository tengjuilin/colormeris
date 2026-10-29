import { CVD_TYPES, grayscale, lightness, parseHexColors, simulateCvd } from '../core/cvd.ts';
import type { ColormapEntry, Rgb, ViewData, ViewKey } from '../types/index.ts';
import { roundRgb } from './common.ts';
import type { ColormapMetrics } from './metrics.ts';
import { colormapMetrics, ratingNotes } from './metrics.ts';

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

type Views = Record<ViewKey, ViewData>;

const baseOf = new Map<string, Rgb[]>();
const viewsOf = new Map<string, Views>(); // `${name}|${reversed}`
const metricsOf = new Map<string, ColormapMetrics>();
const notesCache = new Map<string, ReturnType<typeof ratingNotes>>();

/** The map's original colors, parsed once. */
export function base(map: ColormapEntry): Rgb[] {
  let colors = baseOf.get(map.name);
  if (!colors) {
    colors = parseHexColors(map.colors);
    baseOf.set(map.name, colors);
  }
  return colors;
}

/** The colors of one view, with their lightness (L* is added on first use). */
export function viewData(map: ColormapEntry, view: ViewKey, reversed: boolean): ViewData {
  const key = `${map.name}|${reversed}`;
  let entry = viewsOf.get(key);
  if (!entry) {
    let orig = base(map);
    if (reversed) orig = orig.slice().reverse();
    const made: Record<string, ViewData> = { orig: { colors: orig } };
    for (const type of CVD_TYPES) made[type] = { colors: orig.map((c) => roundRgb(simulateCvd(c, type))) };
    made.gray = { colors: orig.map((c) => roundRgb(grayscale(c))) };
    entry = made as Views;
    viewsOf.set(key, entry);
  }
  const v = entry[view];
  if (!v.L) v.L = v.colors.map((c) => lightness(c));
  return v;
}

/** The rating metrics, computed once per map on the original colors. */
export function metrics(map: ColormapEntry): ColormapMetrics {
  let m = metricsOf.get(map.name);
  if (!m) {
    m = colormapMetrics(base(map), { kind: map.kind, cyclic: map.group === 'cyclic' });
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

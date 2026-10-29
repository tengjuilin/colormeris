import { lightnessStats } from '../../../core/cvd.ts';
import type { ColormapEntry } from '../../../types/index.ts';
import { pct, VIEWS } from '../../common.ts';
import { metrics, viewData } from '../../library-cache.ts';
import { READ_DE, worstCvd } from '../../metrics.ts';

// The pure parts of the Compare tab: the numbers table (columns, facts per map,
// sorting, the best value per column), the plot metrics and the sine test
// images. No DOM and no React, so the rules are unit tested.

/** The four quantities plotted for every map on the same axes. */
export const CMP_METRICS = [
  { key: 'L', label: 'Lightness L*', yLabel: 'L*' },
  { key: 'step', label: 'Perceptual step ΔE2000', yLabel: 'ΔE2000 per step' },
  { key: 'C', label: 'Chroma C*', yLabel: 'C*' },
  { key: 'h', label: 'Hue h°', yLabel: 'h (°)' },
];

export const SINE_N = 256; // pixels per side
export const SINE_PATTERNS = [
  {
    key: 'waves',
    label: 'Sine waves',
    cap: 'Two tilted sine waves and rings around an off-center point, added up and stretched to the whole range: smooth hills (high values), dips (low values) and saddles that never repeat. The data has no edges, so any edge or band you see comes from the colormap.',
  },
  {
    key: 'bumps',
    label: 'Equal bumps',
    cap: 'A smooth ramp from low (top left) to high (bottom right) with 36 bumps of exactly the same height, one at every level. A perceptually uniform sequential map shows every bump equally clearly and the ramp without bands. Other maps hide bumps where they are flat and make others stand out, so equal changes look unequal.',
  },
];

/** A map's direction in Compare: its Browse direction, flipped once more when it was flipped here. */
export const reversedHere = (browseRev: boolean, flipped: ReadonlySet<string>, name: string) =>
  browseRev !== flipped.has(name);

export interface Facts {
  map: ColormapEntry;
  m: ReturnType<typeof metrics>;
  ls: ReturnType<typeof lightnessStats>;
  qual: boolean;
  worstLabel: string;
}

export interface NumCol {
  id: string;
  label: string;
  group?: string;
  /** Shown without "All numbers". */
  key?: boolean;
  hint?: string;
  best?: 'max' | 'min';
  /** Decimals used to compare values as shown. */
  dp?: number;
  noSort?: boolean;
  /** The value to sort and rank by (null = n/a). */
  get?: (f: Facts) => number | string | null;
  show?: (f: Facts) => string;
}

// Numbers for the table: get() gives the value to sort and rank by (null = n/a).
// `key` columns are shown by default; the rest on "All numbers". Columns of
// one group sit next to each other, under one group header.
export const NUM_COLS: NumCol[] = [
  { id: 'name', label: 'Colormap', key: true, get: (f) => f.map.name.toLowerCase() },
  {
    id: 'range',
    group: 'Lightness',
    key: true,
    label: 'L* range',
    hint: 'Spread of lightness. Wider means more contrast.',
    best: 'max',
    dp: 0,
    get: (f) => f.ls.range[1] - f.ls.range[0],
    show: (f) => `${f.ls.range[0].toFixed(0)}–${f.ls.range[1].toFixed(0)}`,
  },
  {
    id: 'mono',
    group: 'Lightness',
    label: 'Monotonic',
    hint: 'Does L* only rise or only fall? Fewer reversals are better.',
    best: 'min',
    dp: 0,
    get: (f) => (f.qual ? null : f.ls.reversals),
    show: (f) => (f.qual ? '—' : `${f.ls.monotonic ? 'yes' : 'no'} (${f.ls.reversals})`),
  },
  {
    id: 'r2',
    group: 'Lightness',
    label: 'L* R²',
    hint: 'How close L* is to a straight line. Higher is better.',
    best: 'max',
    dp: 3,
    get: (f) => (f.qual ? null : f.ls.r2),
    show: (f) => (f.qual || f.ls.r2 == null ? '—' : f.ls.r2.toFixed(3)),
  },
  {
    id: 'cv',
    group: 'Uniformity',
    key: true,
    label: 'Step CV',
    hint: 'Variation of the ΔE2000 steps. Lower is better.',
    best: 'min',
    dp: 2,
    get: (f) => (f.qual ? null : f.m.stepStats.cv),
    show: (f) => (f.qual ? '—' : f.m.stepStats.cv.toFixed(2)),
  },
  {
    id: 'max',
    group: 'Uniformity',
    label: 'Max step ΔE',
    hint: 'Largest ΔE2000 jump between neighbors. Lower is better.',
    best: 'min',
    dp: 2,
    get: (f) => (f.qual ? null : f.m.stepStats.max),
    show: (f) => (f.qual ? '—' : f.m.stepStats.max.toFixed(2)),
  },
  {
    id: 'cvd',
    group: 'Color vision',
    key: true,
    label: 'Worst CVD view',
    hint: 'Smallest ΔE2000 in the worst color-vision view, and the share of the map’s own separation it keeps. Higher is better.',
    best: 'max',
    dp: 1,
    get: (f) => f.m.cvdWorst,
    show: (f) => `${f.worstLabel} ${f.m.cvdWorst.toFixed(1)} ΔE (${pct(f.m.cvdRatio)})`,
  },
  {
    id: 'gray',
    group: 'Color vision',
    label: 'Gray min ΔL*',
    hint: 'Smallest L* difference in grayscale. Higher is better.',
    best: 'max',
    dp: 1,
    get: (f) => f.m.separations.gray?.min ?? null,
    show: (f) => (f.m.separations.gray ? f.m.separations.gray.min.toFixed(1) : '—'),
  },
  {
    id: 'levels',
    group: 'Readability',
    key: true,
    label: 'Levels',
    hint: `Distinguishable levels from end to end (each ${READ_DE} ΔE apart). Higher is better.`,
    best: 'max',
    dp: 0,
    get: (f) => f.m.readability?.orig.levels ?? null,
    show: (f) => (f.m.readability ? String(f.m.readability.orig.levels) : '—'),
  },
  {
    id: 'flat',
    group: 'Readability',
    label: 'Flat %',
    hint: 'Share of the map where values 5% apart look almost the same. Lower is better.',
    best: 'min',
    dp: 2,
    get: (f) => f.m.readability?.orig.flat ?? null,
    show: (f) => (f.m.readability ? pct(f.m.readability.orig.flat) : '—'),
  },
  {
    id: 'amb',
    group: 'Readability',
    key: true,
    label: 'Ambiguous %',
    hint: 'Share of the map whose color has a look-alike elsewhere. Lower is better.',
    best: 'min',
    dp: 2,
    get: (f) => f.m.readability?.orig.ambiguous ?? null,
    show: (f) => (f.m.readability ? pct(f.m.readability.orig.ambiguous) : '—'),
  },
  { id: 'rating', group: 'Ratings', label: 'Ratings', noSort: true },
];

export function facts(map: ColormapEntry): Facts {
  const m = metrics(map);
  const worst = worstCvd(m);
  return {
    map,
    m,
    ls: lightnessStats(viewData(map, 'orig', false).L!),
    qual: map.kind === 'qualitative',
    worstLabel: VIEWS.find((v) => v.key === worst)!.label,
  };
}

export const visibleCols = (allCols: boolean) => NUM_COLS.filter((c) => allCols || c.key);

export interface CmpSort {
  id: string;
  dir: 1 | -1;
}

// none -> ascending -> descending -> back to selection order
export function cycleCmpSort(sort: CmpSort | null, id: string): CmpSort | null {
  if (sort?.id !== id) return { id, dir: 1 };
  return sort.dir > 0 ? { id, dir: -1 } : null;
}

/** The rows in table order: the selection order, or sorted by a column (n/a always last, ties keep the selection order). */
export function sortFacts(rows: Facts[], sort: CmpSort | null): Facts[] {
  if (!sort) return rows;
  const col = NUM_COLS.find((c) => c.id === sort.id);
  if (!col?.get) return rows;
  const get = col.get;
  const keyed = rows.map((f, i) => ({ f, i, v: get(f) }));
  keyed.sort((a, b) => {
    if ((a.v == null) !== (b.v == null)) return a.v == null ? 1 : -1;
    if (a.v == null || b.v == null || a.v === b.v) return a.i - b.i;
    return (a.v < b.v ? -1 : 1) * sort.dir;
  });
  return keyed.map((k) => k.f);
}

// Values are compared as shown (rounded to dp), so ties that look equal count as equal.
export const rounded = (c: NumCol, v: number) => Math.round(v * 10 ** (c.dp ?? 0)) / 10 ** (c.dp ?? 0);

/** The best value of each column that has one; nothing is marked when all values are equal. */
export function bestByColumn(cols: NumCol[], rows: Facts[]): Record<string, number> {
  const best: Record<string, number> = {};
  for (const c of cols) {
    if (!c.best || !c.get) continue;
    const get = c.get;
    const vals = rows
      .map((f) => get(f))
      .filter((v): v is number => typeof v === 'number')
      .map((v) => rounded(c, v));
    if (vals.length < 2) continue;
    const b = c.best === 'max' ? Math.max(...vals) : Math.min(...vals);
    if (vals.some((v) => v !== b)) best[c.id] = b;
  }
  return best;
}

/** Whether a row's value is the best of its column. */
export function isBest(c: NumCol, f: Facts, best: Record<string, number>): boolean {
  const v = c.get?.(f);
  return best[c.id] != null && typeof v === 'number' && rounded(c, v) === best[c.id];
}

/** Group headers over runs of columns of the same group: [label, span]. */
export function groupRuns(cols: NumCol[]): [string, number][] {
  const runs: [string, number][] = [];
  for (let i = 0; i < cols.length; ) {
    let j = i + 1;
    while (j < cols.length && cols[j].group && cols[j].group === cols[i].group) j++;
    runs.push([cols[i].group || '', j - i]);
    i = j;
  }
  return runs;
}

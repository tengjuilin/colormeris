import { lightnessStats } from '../../../core/cvd.ts';
import type { ColormapEntry, ColormapSource } from '../../../types/index.ts';
import { metrics, viewData } from '../../library-cache.ts';
import type { Filters, SortState } from '../viewer-state.ts';

// The pure rules of the Browse tab: which sections and sub-headings exist and
// which start open, how a sort orders the maps, which maps a search and the
// filters show, and how many filters count. No DOM and no React, so each rule
// is unit tested; the component only draws what these return.

/** [group, title, open at first]. With over 300 maps all sections start closed. */
export const SECTIONS: readonly (readonly [string, string, boolean])[] = [
  ['sequential', 'Sequential', false],
  ['diverging', 'Diverging', false],
  ['cyclic', 'Cyclic', false],
  ['rainbow', 'Rainbow', false],
  ['multi-sequential', 'Multi-sequential', false],
  ['qualitative', 'Qualitative', false],
  ['others', 'Others', false],
];

export const SORTS: readonly (readonly [string, string])[] = [
  ['default', 'Default order'],
  ['name', 'Name'],
  ['uniform', 'Most uniform'],
  ['cvd', 'Most CVD-safe'],
  ['gray', 'Most grayscale-safe'],
  ['linear', 'Most linear L*'],
  ['readable', 'Most readable'],
];

/** [id, label, hint, key in rating]. */
export const FILTERS: readonly (readonly [string, string, string, string])[] = [
  ['uniform', 'Uniform', 'Only colormaps rated uniform', 'uniform'],
  ['cvd', 'CVD-safe', 'Only colormaps rated CVD-safe', 'cvdSafe'],
  ['gray', 'Gray-safe', 'Only colormaps rated grayscale-safe', 'graySafe'],
  ['readable', 'Readable', 'Only colormaps rated readable (values can be read back from the colors)', 'readable'],
];

export interface TreeSub {
  sub: string;
  startOpen: boolean;
  names: string[];
}
export type Tree = { group: string; title: string; subs: TreeSub[] }[];

/**
 * Sections in SECTIONS order (empty ones left out), sub-headings in the order
 * their first map appears, maps in library order. Matplotlib's sub-headings
 * start open, and in Sequential only its perceptually uniform ones.
 */
export function buildTree(maps: readonly ColormapEntry[]): Tree {
  const tree: Tree = [];
  for (const [group, title] of SECTIONS) {
    const inGroup = maps.filter((m) => m.group === group);
    if (!inGroup.length) continue;
    const subs: TreeSub[] = [];
    const byName = new Map<string, TreeSub>();
    for (const m of inGroup) {
      let s = byName.get(m.sub);
      if (!s) {
        const rows = inGroup.filter((x) => x.sub === m.sub);
        const startOpen =
          group === 'sequential' ? /perceptually uniform/.test(m.sub) : rows.some((x) => x.source === 'matplotlib');
        s = { sub: m.sub, startOpen, names: [] };
        byName.set(m.sub, s);
        subs.push(s);
      }
      s.names.push(m.name);
    }
    tree.push({ group, title, subs });
  }
  return tree;
}

// ---- sorting ----

const r2Of = new Map<string, number | null>();

function linearity(map: ColormapEntry): number {
  if (map.kind === 'qualitative') return -2;
  let r2 = r2Of.get(map.name);
  if (r2 === undefined) {
    r2 = lightnessStats(viewData(map, 'orig', false).L as number[]).r2 ?? null;
    r2Of.set(map.name, r2);
  }
  return r2 ?? -1;
}

type Cmp = (a: ColormapEntry, b: ColormapEntry) => number;

const SORT_KEYS: Record<string, Cmp> = {
  name: (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  uniform: (a, b) =>
    Number(metrics(a).rating.uniform == null) - Number(metrics(b).rating.uniform == null) ||
    metrics(a).stepStats.cv - metrics(b).stepStats.cv,
  cvd: (a, b) => metrics(b).cvdRatio - metrics(a).cvdRatio || metrics(b).cvdWorst - metrics(a).cvdWorst,
  gray: (a, b) => (metrics(b).separations.gray?.min ?? -1) - (metrics(a).separations.gray?.min ?? -1),
  linear: (a, b) => linearity(b) - linearity(a),
  readable: (a, b) => {
    const ra = metrics(a).readability;
    const rb = metrics(b).readability;
    if (!ra || !rb) return Number(ra == null) - Number(rb == null); // qualitative last
    return ra.orig.flat + ra.orig.ambiguous - (rb.orig.flat + rb.orig.ambiguous) || rb.orig.levels - ra.orig.levels;
  },
};

const indexOf = new WeakMap<readonly ColormapEntry[], Map<string, number>>();
function libraryIndex(maps: readonly ColormapEntry[]): Map<string, number> {
  let m = indexOf.get(maps);
  if (!m) {
    m = new Map(maps.map((x, i) => [x.name, i]));
    indexOf.set(maps, m);
  }
  return m;
}

/**
 * `names` ordered by `sort` (best first for dir 1, reversed for -1). Ties, and
 * no sort, keep the library order of `maps`. Returns a new array.
 */
export function sortNames(names: readonly string[], sort: SortState | null, maps: readonly ColormapEntry[]): string[] {
  const index = libraryIndex(maps);
  const byName = new Map(maps.map((m) => [m.name, m]));
  const cmp = sort && SORT_KEYS[sort.key];
  const order = (n: string) => index.get(n) ?? 0;
  return names.slice().sort((a, b) => {
    const d = cmp ? cmp(byName.get(a) as ColormapEntry, byName.get(b) as ColormapEntry) * (sort as SortState).dir : 0;
    return d || order(a) - order(b);
  });
}

// ---- search and filters ----

/** Whether the search and the filters show the map. Metrics are computed only when a rating filter is on. */
export function isShown(map: ColormapEntry, query: string, filters: Filters): boolean {
  const q = query.trim().toLowerCase();
  if (q !== '' && !map.name.toLowerCase().includes(q)) return false;
  if (filters.sources.length > 0 && !filters.sources.includes(map.source)) return false;
  for (const [id, , , key] of FILTERS) {
    if (!filters.ratings.includes(id)) continue;
    if ((metrics(map).rating as Record<string, unknown>)[key] !== 'yes') return false;
  }
  return true;
}

/** The sources of a family (Python or R packages), in library order. */
export function familyKeys(sources: readonly ColormapSource[], family: string): string[] {
  return sources.filter((s) => s.family === family).map((s) => s.key);
}

/** The number on the Filters button: a fully ticked family counts once, like a library. */
export function filterCount(filters: Filters, sources: readonly ColormapSource[]): number {
  const fams = [...new Set(sources.map((s) => s.family).filter((f): f is string => !!f))];
  let n = filters.ratings.length + filters.sources.length;
  for (const f of fams) {
    const keys = familyKeys(sources, f);
    if (keys.length && keys.every((k) => filters.sources.includes(k))) n -= keys.length - 1;
  }
  return n;
}

/** State of a family's checkbox from the ticked sources: all, some (indeterminate) or none. */
export function familyState(
  ticked: readonly string[],
  family: readonly string[],
): { checked: boolean; indeterminate: boolean } {
  const on = family.filter((k) => ticked.includes(k)).length;
  return { checked: family.length > 0 && on === family.length, indeterminate: on > 0 && on < family.length };
}

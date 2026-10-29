import { VIEWS } from '../common.ts';
import { COMPARE_MAX, VIEWER_TABS } from '../route.ts';

// Pure state of the colormaps page: a reducer with no DOM and no React, so
// every rule (comparison cap, sort cycle, what SHOW_ROW clears) is unit
// tested. It mirrors what viewer.ts, browse-tab.ts and compare-tab.ts keep in
// `state` and in closures today. The link (tab, comparison, open map) is
// written from this state by useUrlSync with formatViewerUrl (route.ts); sort,
// reversed, flipped and the strip view stay out of the URL.

export type StripView = 'all' | (typeof VIEWS)[number]['key'];

export interface SortState {
  key: string;
  /** 1 = best first (A–Z for names), -1 = reversed. */
  dir: 1 | -1;
}

export interface Filters {
  /** Rating filters ticked (uniform, cvd, gray, readable): only maps rated yes. */
  ratings: readonly string[];
  /** Source keys ticked; none ticked shows every library. */
  sources: readonly string[];
}

export interface ViewerState {
  tab: string;
  /** Map open in the detail view (?map=). */
  open: string | null;
  /** Maps in the comparison, in order (?compare=). */
  compare: readonly string[];
  /** Maps flipped in Compare, on top of their Browse direction. */
  compareFlipped: ReadonlySet<string>;
  /** Global Reversed in Browse. */
  reversed: boolean;
  /** Maps shown the other way round in Browse (starts with the maps marked `flip`). */
  flipped: ReadonlySet<string>;
  stripView: StripView;
  sort: SortState | null;
  query: string;
  filters: Filters;
  /** Set by SHOW_ROW; `n` makes a repeat of the same map a new request. */
  reveal: { name: string; n: number } | null;
  /** How useUrlSync writes the link for the last change. */
  history: 'push' | 'replace';
}

export type ViewerAction =
  | { type: 'ROUTE_FROM_URL'; route: { tab: string | null; map: string | null; compare: readonly string[] } }
  | { type: 'GO_TAB'; tab: string }
  | { type: 'OPEN'; name: string | null }
  | { type: 'SET_COMPARED'; name: string; on: boolean }
  | { type: 'MOVE_COMPARED'; name: string; d: number }
  | { type: 'REORDER_COMPARED'; from: number; to: number }
  | { type: 'CLEAR_COMPARED' }
  | { type: 'TOGGLE_COMPARE_REV'; name: string }
  | { type: 'SET_REVERSED'; on: boolean }
  | { type: 'TOGGLE_FLIP'; name: string }
  | { type: 'SET_STRIP_VIEW'; view: string }
  | { type: 'SORT'; key: string }
  | { type: 'SET_SORT'; key: string | null }
  | { type: 'SET_QUERY'; query: string }
  | { type: 'TOGGLE_FILTER'; kind: keyof Filters; key: string; on?: boolean }
  | { type: 'CLEAR_FILTERS' }
  // `hidden`: the map is hidden by the current search or filters (the caller knows the library).
  | { type: 'SHOW_ROW'; name: string; hidden: boolean };

const EMPTY_FILTERS: Filters = { ratings: [], sources: [] };

export const STRIP_VIEW_KEY = 'colormeris.cmapView'; // localStorage: 'all' or one view key

export function isStripView(v: unknown): v is StripView {
  return typeof v === 'string' && (v === 'all' || VIEWS.some((x) => x.key === v));
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

// Storage can be missing or throw (private windows, file://); the default is fine then.
export function loadStripView(storage?: StorageLike): StripView {
  try {
    const v = (storage ?? localStorage).getItem(STRIP_VIEW_KEY);
    if (isStripView(v)) return v;
  } catch {
    /* use the default */
  }
  return 'all';
}

export function saveStripView(view: StripView, storage?: StorageLike): void {
  try {
    (storage ?? localStorage).setItem(STRIP_VIEW_KEY, view);
  } catch {
    /* not remembered */
  }
}

/**
 * The state the page starts in. `flipped` are the maps the export script
 * marked `flip`. A link with ?map= opens on Browse (the old viewer called
 * showRow, which goes to Browse whatever the hash said) and reveals the row.
 */
export function initFromRoute(
  route: { tab: string | null; map: string | null; compare: readonly string[] },
  init: { flipped?: Iterable<string>; stripView?: StripView } = {},
): ViewerState {
  const tab = route.map ? 'browse' : route.tab && VIEWER_TABS.includes(route.tab) ? route.tab : 'browse';
  return {
    tab,
    open: route.map,
    compare: route.compare.slice(0, COMPARE_MAX),
    compareFlipped: new Set(),
    reversed: false,
    flipped: new Set(init.flipped ?? []),
    stripView: init.stripView ?? 'all',
    sort: null,
    query: '',
    filters: EMPTY_FILTERS,
    reveal: route.map ? { name: route.map, n: 1 } : null,
    history: 'replace',
  };
}

const toggled = (set: ReadonlySet<string>, name: string): ReadonlySet<string> => {
  const next = new Set(set);
  if (!next.delete(name)) next.add(name);
  return next;
};

// Sorting a column: none -> best first -> reversed -> none.
export function cycleSort(sort: SortState | null, key: string): SortState | null {
  if (sort?.key !== key) return { key, dir: 1 };
  return sort.dir > 0 ? { key, dir: -1 } : null;
}

// The comparison list after one change; the same list when nothing changes.
export function comparedWith(list: readonly string[], name: string, on: boolean): readonly string[] {
  const i = list.indexOf(name);
  if (on && i < 0 && list.length < COMPARE_MAX) return [...list, name];
  if (!on && i >= 0) return list.filter((n) => n !== name);
  return list;
}

export function comparedMoved(list: readonly string[], name: string, d: number): readonly string[] {
  const i = list.indexOf(name);
  const j = i + d;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = list.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function comparedReordered(list: readonly string[], from: number, to: number): readonly string[] {
  const n = list.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return list;
  const next = list.slice();
  const [name] = next.splice(from, 1);
  next.splice(to, 0, name);
  return next;
}

export function filtering(s: Pick<ViewerState, 'query' | 'filters'>): boolean {
  return s.query.trim() !== '' || s.filters.ratings.length > 0 || s.filters.sources.length > 0;
}

export function viewerReducer(s: ViewerState, a: ViewerAction): ViewerState {
  const replace = <T extends Partial<ViewerState>>(patch: T): ViewerState => ({ ...s, ...patch, history: 'replace' });
  switch (a.type) {
    case 'ROUTE_FROM_URL':
      // A hash such as #ref-… leaves the tab alone (tab: null). Nothing is written back.
      return replace({
        tab: a.route.tab && VIEWER_TABS.includes(a.route.tab) ? a.route.tab : s.tab,
        open: a.route.map,
        compare: a.route.compare.slice(0, COMPARE_MAX),
      });
    case 'GO_TAB':
      if (!VIEWER_TABS.includes(a.tab)) return s;
      // From code (Identify's Show button, SHOW_ROW) a tab change is a history entry.
      return { ...s, tab: a.tab, history: a.tab === s.tab ? 'replace' : 'push' };
    case 'OPEN':
      return s.open === a.name ? s : replace({ open: a.name });
    case 'SET_COMPARED': {
      const next = comparedWith(s.compare, a.name, a.on);
      return next === s.compare ? s : replace({ compare: next });
    }
    case 'MOVE_COMPARED': {
      const next = comparedMoved(s.compare, a.name, a.d);
      return next === s.compare ? s : replace({ compare: next });
    }
    case 'REORDER_COMPARED': {
      const next = comparedReordered(s.compare, a.from, a.to);
      return next === s.compare ? s : replace({ compare: next });
    }
    case 'CLEAR_COMPARED':
      return s.compare.length ? replace({ compare: [] }) : s;
    case 'TOGGLE_COMPARE_REV':
      return replace({ compareFlipped: toggled(s.compareFlipped, a.name) });
    case 'SET_REVERSED':
      return s.reversed === a.on ? s : replace({ reversed: a.on });
    case 'TOGGLE_FLIP':
      return replace({ flipped: toggled(s.flipped, a.name) });
    case 'SET_STRIP_VIEW':
      return isStripView(a.view) && a.view !== s.stripView ? replace({ stripView: a.view }) : s;
    case 'SORT':
      return replace({ sort: cycleSort(s.sort, a.key) });
    case 'SET_SORT':
      // The Sort select: a key starts best first; 'default' (or null) is the library order.
      return replace({ sort: a.key && a.key !== 'default' ? { key: a.key, dir: 1 } : null });
    case 'SET_QUERY':
      return s.query === a.query ? s : replace({ query: a.query });
    case 'TOGGLE_FILTER': {
      const list = s.filters[a.kind];
      const has = list.includes(a.key);
      const on = a.on ?? !has;
      if (on === has) return s;
      const next = on ? [...list, a.key] : list.filter((k) => k !== a.key);
      return replace({ filters: { ...s.filters, [a.kind]: next } });
    }
    case 'CLEAR_FILTERS':
      return s.filters.ratings.length || s.filters.sources.length ? replace({ filters: EMPTY_FILTERS }) : s;
    case 'SHOW_ROW': {
      // Browse, without the search and filters that hide the map, with it open and revealed.
      return {
        ...s,
        tab: 'browse',
        open: a.name,
        query: a.hidden ? '' : s.query,
        filters: a.hidden ? EMPTY_FILTERS : s.filters,
        reveal: { name: a.name, n: (s.reveal?.n ?? 0) + 1 },
        history: s.tab === 'browse' ? 'replace' : 'push',
      };
    }
  }
}

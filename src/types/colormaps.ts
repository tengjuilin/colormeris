// The colormap library (src/generated/colormap-data.json, unpacked by
// core/colormap-library.ts) and the context the colormap viewer's modules
// share (colormaps/viewer.ts builds it, the tabs extend it).

import type { Rgb } from './image.ts';

/** A package or collection the maps come from. */
export interface ColormapSource {
  key: string;
  label: string;
  family?: string;
  version: string;
}

/** Library section of a map. */
export type ColormapGroup =
  | 'sequential'
  | 'diverging'
  | 'cyclic'
  | 'rainbow'
  | 'qualitative'
  | 'others'
  | (string & {});

/**
 * A map as the app sees it. In the JSON its colors are packed (`rgb`, base64
 * of per-channel differences); colormap-library.ts unpacks them lazily into
 * `colors`: 6-digit hex strings concatenated (256 samples, or the listed colors).
 */
export interface ColormapEntry {
  name: string;
  group: ColormapGroup;
  /** Sub-heading, e.g. "Python packages: Matplotlib". */
  sub: string;
  /** ColormapSource key. */
  source: string;
  kind: 'continuous' | 'qualitative';
  colors: string;
  /** Sequential maps shown reversed in Browse so they run dark to light. */
  flip?: boolean;
}

/** A map in the generated JSON, before unpacking. */
export type PackedColormapEntry = Omit<ColormapEntry, 'colors'> & { rgb: string };

/** The library: cmapData. */
export interface ColormapData {
  sources: ColormapSource[];
  maps: ColormapEntry[];
}

/** One of the viewer's views of a map (common.ts VIEWS). */
export type ViewKey = 'orig' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'gray';

/** A map's colors in one view, with their lightness (viewData). */
export interface ViewData {
  colors: Rgb[];
  L?: number[];
}

/** The viewer's shared state. */
export interface CmapViewerState {
  reversed: boolean;
  /** Maps in the comparison (?compare=). */
  selected: string[];
  /** Map open in the detail view (?map=). */
  open: string | null;
  tab: string;
  stripView: string;
  sort: { key: string; dir: number } | null;
  /** Maps shown the other way round in Browse. */
  flipped: Set<string>;
}

/** One row of the Browse list (viewer.ts `items`). */
export interface CmapListItem {
  map: ColormapEntry;
  item: HTMLElement;
  strips: HTMLElement[];
  panel: HTMLElement;
  button: HTMLElement;
  cmpBtn: HTMLElement;
  order: number;
}

/**
 * The context the viewer's modules share (`ctx`). viewer.ts builds the first
 * members (helpers from common.ts among them); each module adds what it
 * returns, and later modules use what earlier ones added. The module
 * members are a UI seam left loose for now.
 */
export interface CmapViewerContext {
  // ---- common.ts helpers and constants
  // biome-ignore lint/suspicious/noExplicitAny: TODO(types) DOM seam, see common.ts el
  el: (tag: string, attrs?: Record<string, unknown> | null, text?: unknown) => any;
  svgEl: (tag: string, attrs?: Record<string, unknown>) => SVGElement;
  pct: (v: number) => string;
  clamp8: (v: number) => number;
  roundRgb: (rgb: Rgb) => Rgb;
  anchorPopover: (btn: HTMLElement, pop: HTMLElement) => void;
  VIEWS: { key: ViewKey; label: string; short: string }[];
  RATING_COLS: { key: string; abbr: string; label: string; sort: string }[];
  GLYPH: Record<string, string>;
  PILL: Record<string, string>;
  // ---- viewer.ts
  data: ColormapData;
  state: CmapViewerState;
  items: CmapListItem[];
  mapByName: Map<string, ColormapEntry>;
  root: HTMLElement;
  base: (map: ColormapEntry) => Rgb[];
  viewData: (map: ColormapEntry, view: ViewKey, reversed?: boolean) => ViewData;
  // biome-ignore lint/suspicious/noExplicitAny: TODO(types) colormaps/metrics.ts colormapMetrics result
  metrics: (map: ColormapEntry) => any;
  sepOf: (map: ColormapEntry, key: string) => { min: number; t: number[] } | null | undefined;
  rev: <T>(a: T[], reversed?: boolean) => T[];
  isRev: (map: ColormapEntry) => boolean;
  ratingPills: (map: ColormapEntry) => HTMLElement;
  ratingCells: (map: ColormapEntry) => HTMLElement[];
  updateUrl: () => void;
  goTab: (tab: string) => void;
  setCompared: (name: string, on: boolean) => void;
  onCompareChange: () => void;
  openDetail: (name: string) => void;
  recolorFigure: (file: File, line?: unknown) => void;
  showRow: (name: string, opts?: { smooth?: boolean }) => void;
  // ---- strips.ts members used by the map picker
  stripCanvas: (colors: Rgb[], qualitative: boolean) => HTMLCanvasElement;
  // ---- added by the modules: strips.ts (stripCanvas, renderStrip, makeStrip,
  // showTip, hideTip), plots.ts, footer.ts (refNumber, methodList,
  // buildFooter, …), browse-tab.ts (headerRow, applyStripView, buildRow),
  // then detail and compare.
  // biome-ignore lint/suspicious/noExplicitAny: TODO(types) module members of the colormap viewer
  [key: string]: any;
}

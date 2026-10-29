// The colormap library (src/generated/colormap-data.json, unpacked by
// core/colormap-library.ts) and the types around it.

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

// The colormap library (src/generated/colormap-data.json, written by
// scripts/export-mpl-colormaps.py; do not edit the JSON by hand).
// Colors are packed (`rgb`: base64 of per-channel differences, see pack_colors);
// `colors` unpacks them into 6-digit hex strings concatenated (256 samples, or the listed colors).
// The lookups below are the one place maps are found by name and their
// colors parsed: every module shares the same arrays, so the caches keyed by
// a color list (the matcher's Lab, the recolor LUT) hit across tabs.
import raw from '../generated/colormap-data.json';
import type { ColormapData, ColormapEntry, ColormapSource, PackedColormapEntry, Rgb } from '../types/index.ts';
import { parseHexColors } from './color.ts';

function unpackRgb(b64: string): string {
  const s = atob(b64);
  const v = new Uint8Array(s.length);
  let hex = '';
  for (let i = 0; i < s.length; i++) {
    v[i] = (s.charCodeAt(i) + (i >= 3 ? v[i - 3] : 0)) & 255;
    hex += (v[i] < 16 ? '0' : '') + v[i].toString(16);
  }
  return hex;
}

const data = raw as unknown as { sources: ColormapSource[]; maps: Partial<PackedColormapEntry>[] };
for (const m of data.maps) {
  const rgb = m.rgb as string;
  delete m.rgb;
  let hex: string | null = null;
  Object.defineProperty(m, 'colors', { enumerable: true, get: () => (hex ??= unpackRgb(rgb)) });
}

export const cmapData = data as unknown as ColormapData;

let byName: Map<string, ColormapEntry> | null = null;

/** The library's map with this name, or undefined. */
export function mapByName(name: string): ColormapEntry | undefined {
  byName ??= new Map(cmapData.maps.map((m) => [m.name, m]));
  return byName.get(name);
}

const colorsOf = new Map<string, Rgb[]>();

/** A map's colors as [r, g, b] (0–255), parsed once and shared: never mutate the array. */
export function mapColors(map: ColormapEntry): Rgb[] {
  let c = colorsOf.get(map.name);
  if (!c) colorsOf.set(map.name, (c = parseHexColors(map.colors)));
  return c;
}

/** A library map in the matcher's form (colormap-match.ts MatchMap). */
export interface LibraryMap {
  name: string;
  kind: string;
  source: string;
  rgbs: Rgb[];
}

let matchMaps: LibraryMap[] | null = null;

/** Every map as { name, kind, source, rgbs }, in library order, built once. */
export function libraryMaps(): LibraryMap[] {
  matchMaps ??= cmapData.maps.map((m) => ({ name: m.name, kind: m.kind, source: m.source, rgbs: mapColors(m) }));
  return matchMaps;
}

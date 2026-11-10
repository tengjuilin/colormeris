// Types of the package's public API: geometry, colors, pixel buffers,
// colorbar samples and the colormap library. Copied from the Colormeris app's
// src/types (image.ts, colormaps.ts, results.ts).

/** A point in image pixels. */
export interface Point {
  x: number;
  y: number;
}

/** [r, g, b], 0–255. Means and medians may be fractional. */
export type Rgb = number[];

/** [L*, a*, b*] in CIELAB. */
export type Lab = number[];

/**
 * An RGBA pixel buffer, row-major, 4 bytes per pixel. ImageData satisfies it,
 * and the tests build plain objects of this shape.
 */
export interface PixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Color distance used to match colors to a colorbar (colorDistance). */
export type DistanceName = 'de2000' | 'de76';

/** One sample of a colorbar (sampleColorbar, colormapSamples): t in [0, 1] from start to end. */
export interface ColorbarSample {
  t: number;
  rgb: Rgb;
  lab: Lab;
}

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

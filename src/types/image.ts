// Geometry, colors and pixel buffers shared by every module. Coordinates are
// page pixels of the rendered page image unless a comment says otherwise.

/** A point in page pixels (or box coordinates for replicated ROIs). */
export interface Point {
  x: number;
  y: number;
}

/** An axis-aligned box in page pixels (locate.js, agent/decide.js). */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Normalized position inside a grid: u along columns, v along rows, [0, 1] inside. */
export interface UV {
  u: number;
  v: number;
}

/**
 * Four grid points in the order [topLeft, topRight, bottomRight, bottomLeft].
 * An array rather than a tuple: the code maps and rebuilds corners freely.
 */
export type Corners = Point[];

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

/** Color distance used to match colors to a colorbar (core/color.js colorDistance). */
export type DistanceName = 'de2000' | 'de76';

// Shared types of the locate modules: colorbar strips and connected components.

import type { Box, Point, Rgb } from '../../types/index.ts';

/** A pixel test, such as "differs from the page". */
export type PixelTest = (rgb: Rgb) => boolean;

/** A colorbar strip: a box and its direction. */
export interface Bar extends Box {
  vertical: boolean;
}

/** What a strip looks like along its length. */
export type StripKind = 'smooth' | 'binned' | 'categorical';

/** A colorbar candidate (findColorbars). */
export interface BarCandidate extends Bar {
  kind: StripKind;
}

/** A connected component of ink: its box and pixel count. */
export interface Component extends Box {
  n: number;
}

/** A tick label: its extent along the strip (u) and away from it (d), characters and box. */
export interface TickLabel {
  u0: number;
  u1: number;
  d0: number;
  d1: number;
  n: number;
  box: Box;
}

/** A character component in the strip's frame (u along it, d away from it). */
export interface FrameComp extends Component {
  u0: number;
  u1: number;
  d0: number;
  d1: number;
  size: number;
  across: number;
}

/** The side findTickLabels chose, for tickMarks. */
export interface TickBest {
  side: string;
  score: number;
  on: TickLabel[];
  row: TickLabel[];
  charH: number;
  ticks: number[];
}

/** findTickLabels' answer: `at` is a label's middle on the strip's centre line. */
export interface TickLabelsResult {
  side: string;
  marks: { at: Point; box: Box; note?: string }[];
  score: number;
  bar?: Bar | Box;
}

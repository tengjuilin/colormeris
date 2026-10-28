// Types shared by the decision-mode modules.

import type { Box, Point } from '../../types/index.ts';

// Shapes used by several functions below.
export type Side = 'left' | 'right' | 'above' | 'below';
export type Axis = 'row' | 'col';
/** A fraction span [from, to] of a box along an axis, 0–1. */
export type Span = [number, number];
/** A tick as the checks see it: position t along the bar and printed value. */
export interface TickTV {
  t: number;
  value: number;
}
/** A tick-label box of findTickLabels: where it projects on the strip, and a note on odd ones. */
interface TickMark {
  at: Point;
  box?: Box;
  note?: string;
}
/** A colorbar strip found on the page (stripCandidate). */
export interface StripInfo {
  bar: Box;
  labelSide: string | null;
  labels: number;
  labelsAt?: Point[];
}
/** A candidate with its place relative to the cells (chooseColorbar). */
export interface PlacedStrip extends StripInfo {
  at: { side: Side; gap: number };
}
/** A panel as gridNeighbours and regridOthers see it. */
export interface PlacedPanel {
  id: string;
  name?: string;
  cells: Box;
  rows: number;
  cols: number;
  unsure?: { row?: boolean; col?: boolean };
}
/** What gridNeighbours lends to planCounts. */
export interface Neighbours {
  col?: { count: number; id: string; name?: string };
  row?: { count: number; id: string; name?: string };
  rowCell?: number;
  colCell?: number;
  cell?: number;
}
/** The fields of fitCellCounts' result that planCounts reads (all optional: fields by axis name). */
export interface CountFit {
  rows?: number;
  cols?: number;
  rowScore?: number;
  colScore?: number;
  rowAlt?: number | null;
  colAlt?: number | null;
  rowAltScore?: number;
  colAltScore?: number;
  rowSize?: number;
  colSize?: number;
  rowReason?: string;
  colReason?: string;
  rowSpan?: number[];
  colSpan?: number[];
}
/** The fields of detectGridSize's result that planCounts reads. */
export interface CountDetection {
  rows: number;
  cols: number;
  rowConfidence?: number;
  colConfidence?: number;
}
/** planCounts' result. */
export interface CountPlan {
  rows: number;
  cols: number;
  span: Partial<Record<Axis, Span>>;
  alt: Partial<Record<Axis, number>>;
  unsure: { row: boolean; col: boolean };
  notes: string[];
}

// What the tools compute from a panel and its page image (computeResult):
// heatmap/sampling.ts, roi/quantify.ts and map/field.ts. Results are shared by
// the workspace, the exports and the agent, so their shapes live here.

import type { Lab, Point, Rgb } from './image.ts';
import type { ColorbarScale, Roi, ScaleUnit } from './project.ts';

/**
 * A panel that is not calibrated yet. Success results declare `error?: never`,
 * so `if (res.error)` narrows a PanelResult.
 */
export interface ErrorResult {
  error: string;
}

/** One sample of a colorbar (sampleColorbar, colormapSamples): t in [0, 1] from start to end. */
export interface ColorbarSample {
  t: number;
  rgb: Rgb;
  lab: Lab;
}

/** A flat bin of a binned colorbar (colorbarBins). */
export interface ColorBin {
  t0: number;
  t1: number;
  lab: Lab;
  rgb: Rgb;
}

/** Which way a value is a bound: the true value lies below or above it. */
export type OpenSide = 'below' | 'above';

/** A bin with its value (labelBins); open-ended end bins carry the outermost tick's value. */
export interface LabelledBin extends ColorBin {
  value: number;
  open: OpenSide | null;
}

/** Cell status (colorStatus, plus 'empty' for a dot plot cell without a dot). */
export type CellStatus = 'ok' | 'flagged' | 'clamped' | 'off-map' | 'empty';

/** Why a color is off the colormap. */
export type OffMapReason = 'gray' | 'hue' | 'far';

/** One heatmap cell (extractPanel). value is NaN for off-map and empty cells. */
export interface HeatmapCell {
  /** Null for an empty dot-plot cell. */
  rgb: Rgb | null;
  t: number;
  value: number;
  deltaE: number;
  flagged: boolean;
  status: CellStatus;
  /** Clamped cells: which end of the bar they are past. */
  end?: 'start' | 'end';
  open?: OpenSide;
  reason?: OffMapReason;
  /** Index into result.bins on a binned bar. */
  bin?: number;
  /** Dot radius in page pixels (grid anchor 'centers'). */
  radius?: number | null;
  empty?: boolean;
}

/** Counts of each cell status (offMap counts 'off-map'). */
export interface CellCounts {
  cells: number;
  ok: number;
  flagged: number;
  clamped: number;
  offMap: number;
  empty: number;
  open: number;
}

/** extractPanel's result. */
export interface HeatmapResult {
  error?: never;
  rows: number;
  cols: number;
  cells: HeatmapCell[][];
  samples: ColorbarSample[];
  scale: ColorbarScale;
  /** Null for a smooth bar. */
  bins: LabelledBin[] | null;
  counts: CellCounts;
  /** Share of valued cells clamped to an end of the bar. */
  clampedShare: number;
}

/** Statistics of one ROI copy (quantifyOutline). Real-unit areas only with a scale bar. */
export interface RoiStats {
  areaPx: number;
  signalPx: number;
  flaggedPx: number;
  sum: number;
  mean: number;
  meanSignal: number;
  max: number;
  area?: number;
  signalArea?: number;
  sumArea?: number;
}

/** One ROI copy; row and col are null for a region outside every grid box. */
export interface RoiRow {
  roi: Roi;
  row: number | null;
  col: number | null;
  outline: Point[];
  stats: RoiStats;
}

/** quantifyPanel's result. */
export interface RoiResult {
  error?: never;
  rows: RoiRow[];
  /** Real area of one pixel (pixelArea), null without a scale bar. */
  pxArea: number | null;
  unit: ScaleUnit | null;
}

/** Summary of a map's values (extractField). */
export interface MapStats {
  min: number;
  max: number;
  flagged: number;
  clippedLow: number;
  clippedHigh: number;
  /** How many distinct values the sampled colorbar can tell apart. */
  levels: number;
}

/** extractField's result: typed arrays are row-major, rows × cols. */
export interface MapField {
  error?: never;
  rows: number;
  cols: number;
  bin: number;
  width: number;
  height: number;
  values: Float64Array;
  t: Float32Array;
  deltaE: Float32Array;
  /** Bit flags FLAG_DELTA_E | FLAG_LOW | FLAG_HIGH. */
  flags: Uint8Array;
  /** Coordinates of bin centres (axis values, pixels or lengths; null where an axis has no function). */
  xs: (number | null)[];
  ys: (number | null)[];
  xAxis: boolean;
  yAxis: boolean;
  xName: string;
  yName: string;
  axisProblems: string[];
  samples: ColorbarSample[];
  stats: MapStats;
}

/** One sample along a profile (sampleProfile). x/y are axis values or null; len is null without a scale bar. */
export interface ProfileSample {
  d: number;
  len: number | null;
  x: number | null;
  y: number | null;
  px: number;
  py: number;
  value: number;
  deltaE: number;
  flagged: boolean;
  clipped: boolean;
  outside: boolean;
}

/** The map tool's result: the field (or its error) plus profile id → samples or {error}. */
export type MapResult = (MapField | ErrorResult) & {
  profiles: Record<string, ProfileSample[] | ErrorResult>;
};

/** Any tool's result, as returned by ws.resultFor. Tools cast to their own type. */
export type PanelResult = HeatmapResult | RoiResult | MapResult | ErrorResult;

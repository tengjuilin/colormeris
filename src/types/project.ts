// The project model (extract/project/project.ts) as it lives in memory. All
// coordinates are page pixels of the rendered page image. project.json
// (schema v2) is built from these by serializeProject and read back by
// parseProject; the file shapes are inferred from those functions.

import type { Corners, DistanceName, Point } from './image.ts';

/** The three tools of extract.html; a panel belongs to one (KINDS). */
export type ToolKind = 'heatmap' | 'roi' | 'map';

/** What the clicked grid points are: outer corners, or corner-cell centers of a dot plot (GRID_ANCHORS). */
export type GridAnchor = 'corners' | 'centers';

/** Sampled area of a cell (GRID_SHAPES). */
export type GridShape = 'square' | 'circle';

/** Colorbar scales (core/colorbar.ts SCALES). Piecewise scales interpolate between neighbouring ticks only. */
export type ColorbarScale = 'linear' | 'log10' | 'piecewise' | 'piecewise-log10';

/** Scales of a map axis (AXIS_SCALES). */
export type AxisScale = 'linear' | 'log10';

/** ROI shapes (SHAPES). */
export type RoiShape = 'ellipse' | 'rect' | 'polygon';

/** Units of a scale bar (SCALE_UNITS). */
export type ScaleUnit = 'cm' | 'mm' | 'µm' | 'nm';

/** How map coordinates are reported (MAP_UNITS): axis values, pixels, or scale-bar lengths. */
export type MapUnits = 'axis' | 'px' | 'length';

/** Heatmap grid; the map tool uses it as its plot area (1 × 1, sampleFraction 1). */
export interface Grid {
  /** TL, TR, BR, BL; null until placed. */
  corners: Corners | null;
  anchor: GridAnchor;
  shape: GridShape;
  rows: number;
  cols: number;
  /** Share of a cell (or of a dot's radius) that is sampled. */
  sampleFraction: number;
  /** Typed labels; may be shorter than rows/cols (effectiveLabels pads them). */
  rowLabels: string[];
  colLabels: string[];
  /** Own names per box in reading order (ROI tool), usually empty. */
  boxLabels: string[];
  /**
   * Set late, never by createPanel: true while rows/cols come from detection
   * (re-detected after a corner drag), false once set by hand or by the agent.
   * Not saved in project.json.
   */
  autoSize?: boolean;
}

/** A known colormap read instead of the bar in the figure. */
export interface ColormapRef {
  name: string;
  reversed: boolean;
}

/**
 * A colorbar tick: either a page point ({x, y}, projected onto the bar line)
 * or, with a known colormap, a typed position ({t}) along it. One shape with
 * optional fields because the code tells them apart with Number.isFinite(k.x).
 * `value` is NaN until typed. `id` ("t1", …) is given by ws.newTickId; ticks
 * read by parseProject have none until source.ts assigns them.
 */
export interface Tick {
  id?: string;
  x?: number;
  y?: number;
  t?: number;
  value: number;
}

/** A tick with its position along the bar resolved (ticksWithT); t is NaN when unknown. */
export interface TickWithT extends Tick {
  t: number;
}

export interface Colorbar {
  /** Ends of the bar's centre line; null until placed (optional with a colormap). */
  start: Point | null;
  end: Point | null;
  /** Pixels averaged on each side of the line when sampling. */
  halfWidth: number;
  nSamples: number;
  ticks: Tick[];
  scale: ColorbarScale;
  colormap: ColormapRef | null;
}

/** Matching settings kept per panel, so a project zip reproduces its values. */
export interface PanelSettings {
  distance: DistanceName;
  maxDeltaE: number;
  /** ROI tool's background threshold (CIELAB chroma). */
  grayChroma: number;
}

/** Ellipse or rect: centre and radii (a rect's rx/ry are half-extents). */
export interface ShapeGeom {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface PolygonGeom {
  points: Point[];
}

export type RoiGeom = ShapeGeom | PolygonGeom;

/** Nudge of one replicated copy, keyed by offsetKey(row, col) = "row,col". */
export interface RoiOffset {
  dx: number;
  dy: number;
}

/**
 * Region of interest. A replicated ROI is copied into every grid box and its
 * geom is in box coordinates ([0, 1]² per box); otherwise geom is in page pixels.
 */
interface RoiBase {
  id: string;
  name: string;
  replicate: boolean;
  offsets: Record<string, RoiOffset>;
}

export interface ShapeRoi extends RoiBase {
  shape: 'ellipse' | 'rect';
  geom: ShapeGeom;
}

export interface PolygonRoi extends RoiBase {
  shape: 'polygon';
  geom: PolygonGeom;
}

/** Narrow with `roi.shape === 'polygon'`; functions taking (shape, geom) separately need a cast. */
export type Roi = ShapeRoi | PolygonRoi;

/** A scale bar: two page points and the real length between them (ROI and Map tools). */
export interface ScaleBar {
  p1: Point;
  p2: Point;
  length: number;
  unit: ScaleUnit;
}

/** A map axis tick on the plot area's edge; value is NaN until typed. */
export interface AxisTick {
  id: string;
  x: number;
  y: number;
  value: number;
}

export interface MapAxis {
  ticks: AxisTick[];
  scale: AxisScale;
}

/** A line profile across a map, averaged over ±halfWidth pixels. */
export interface Profile {
  id: string;
  name: string;
  a: Point;
  b: Point;
  halfWidth: number;
}

/** Map tool data of a panel (map/field.ts). */
export interface MapSettings {
  /** Bin side in rendered pixels (1 = native). */
  bin: number;
  units: MapUnits;
  x: MapAxis;
  y: MapAxis;
  profiles: Profile[];
}

export type ReviewVerdict = 'accepted' | 'rejected';

/** What reviewStatus reports: the verdict while the values are unchanged, 'stale' after. */
export type ReviewStatus = ReviewVerdict | 'stale';

/** Review of a panel's values; it applies while they still hash to resultHash (agent/schema.ts). */
export interface Review {
  status: ReviewVerdict;
  by: string | null;
  confidence: number | null;
  note: string;
  resultHash: string;
  time: string | null;
}

/**
 * One calibrated figure panel. Every panel has every tool's fields (createPanel);
 * `tool` says which are used. `page` is 1-based (always 1 for images).
 */
export interface Panel {
  id: string;
  name: string;
  page: number;
  tool: ToolKind;
  grid: Grid;
  colorbar: Colorbar;
  settings: PanelSettings;
  /** ROI tool. */
  rois: Roi[];
  /** ROI and Map tools. */
  scale: ScaleBar | null;
  /** Map tool. */
  map: MapSettings;
  review: Review | null;
}

/**
 * The loaded file. Set by source.ts on open (renderScale, pageCount, sha256
 * later); parseProject copies whatever a project.json carried, so files from
 * buildProjectZip also have the zip fields.
 */
export interface SourceInfo {
  fileName: string;
  mime: string | null;
  /** Page on screen, 1-based. */
  page: number;
  pageCount: number;
  /** PDF render scale (1 for images). */
  renderScale: number;
  width: number;
  height: number;
  /** Filled in asynchronously after open. */
  sha256: string | null;
  /** Written into project zips only (project-files.ts). */
  originalFile?: string | null;
  pageImages?: Record<string, string>;
  pageImage?: string | null;
}

/** All panels of every tool for one source file. */
export interface Project {
  name: string;
  source: SourceInfo | null;
  panels: Panel[];
  activePanelId: string;
}

import { bilinear, invertBilinear } from '../../core/grid.ts';
import type { Box, Grid, Point, PolygonGeom, Roi, RoiGeom, RoiOffset, RoiShape, ShapeGeom } from '../../types/index.ts';

/** A region's shape and geometry; a whole Roi satisfies it. */
export interface ShapedGeom {
  shape: RoiShape;
  geom: RoiGeom;
}

/** One placed copy of a region: its outline in image pixels; row and col are null for an unreplicated region. */
export interface RoiInstance {
  row: number | null;
  col: number | null;
  outline: Point[];
}

// Regions of interest (ROIs) for image quantification.
//
// An ROI is {id, name, shape: 'ellipse' | 'rect' | 'polygon', replicate,
// geom, offsets}. Ellipses and rects use geom {cx, cy, rx, ry} (a rect's rx/ry
// are half-extents); polygons use geom {points: [{x, y}]}.
//
// A replicated ROI is copied into every box of a grid. Its geom is then in
// box coordinates: a box spans [0, 1]² with x along columns and y along rows,
// and offsets[`${row},${col}`] = {dx, dy} nudges the copy in one box. A
// non-replicated ROI's geom is in image pixels.

const ELLIPSE_POINTS = 72;

// Polygon outline of the shape in its own coordinates.
export function shapeOutline(roi: ShapedGeom): Point[] {
  const g = roi.geom as ShapeGeom;
  if (roi.shape === 'polygon') return (roi.geom as PolygonGeom).points.map((p) => ({ x: p.x, y: p.y }));
  if (roi.shape === 'rect') {
    return [
      { x: g.cx - g.rx, y: g.cy - g.ry },
      { x: g.cx + g.rx, y: g.cy - g.ry },
      { x: g.cx + g.rx, y: g.cy + g.ry },
      { x: g.cx - g.rx, y: g.cy + g.ry },
    ];
  }
  const out: Point[] = [];
  for (let i = 0; i < ELLIPSE_POINTS; i++) {
    const a = (2 * Math.PI * i) / ELLIPSE_POINTS;
    out.push({ x: g.cx + g.rx * Math.cos(a), y: g.cy + g.ry * Math.sin(a) });
  }
  return out;
}

export const offsetKey = (row: number, col: number) => `${row},${col}`;

export function boxOffset(roi: Pick<Roi, 'offsets'>, row: number, col: number): RoiOffset {
  return roi.offsets?.[offsetKey(row, col)] || { dx: 0, dy: 0 };
}

// Map a point in box coordinates of box (row, col) to image pixels.
export function fromBox(grid: Grid, p: Point, row: number, col: number): Point {
  return bilinear(grid.corners!, (p.x + col) / grid.cols, (p.y + row) / grid.rows);
}

// Map an image point to box coordinates of box (row, col).
export function toBox(grid: Grid, p: Point, row: number, col: number): Point {
  const { u, v } = invertBilinear(grid.corners!, p);
  return { x: u * grid.cols - col, y: v * grid.rows - row };
}

// Every placed copy of an ROI: [{row, col, outline}] with outlines in image
// pixels. A replicated ROI without a grid has no copies.
export function roiInstances(roi: Roi, grid: Grid | null | undefined): RoiInstance[] {
  const outline = shapeOutline(roi);
  if (!roi.replicate) return [{ row: null, col: null, outline }];
  if (!grid?.corners) return [];
  const out: RoiInstance[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const { dx, dy } = boxOffset(roi, row, col);
      out.push({ row, col, outline: outline.map((p) => fromBox(grid, { x: p.x + dx, y: p.y + dy }, row, col)) });
    }
  }
  return out;
}

export function pointInPolygon(p: Point, poly: Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Calls fn(x, y) for every pixel whose centre lies inside the polygon.
export function forEachPixelInPolygon(poly: Point[], width: number, height: number, fn: (x: number, y: number) => void) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const ys = Math.max(0, Math.floor(y0));
  const ye = Math.min(height - 1, Math.ceil(y1));
  const xs = Math.max(0, Math.floor(x0));
  const xe = Math.min(width - 1, Math.ceil(x1));
  for (let y = ys; y <= ye; y++) {
    // Scanline: collect crossings of the row through pixel centres.
    const cy = y + 0.5;
    const xsCross: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > cy !== b.y > cy) xsCross.push(((b.x - a.x) * (cy - a.y)) / (b.y - a.y) + a.x);
    }
    xsCross.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xsCross.length; k += 2) {
      const from = Math.max(xs, Math.ceil(xsCross[k] - 0.5));
      const to = Math.min(xe, Math.ceil(xsCross[k + 1] - 0.5) - 1);
      for (let x = from; x <= to; x++) fn(x, y);
    }
  }
}

export function polygonArea(poly: Point[]) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(a) / 2;
}

export function centroid(poly: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

// Build ROI geometry from a drag between two image points: an ellipse or rect
// inscribed in the dragged box; `equal` (Shift) makes it a circle/square.
export function boxGeom(a: Point, b: Point, equal?: boolean): ShapeGeom {
  let w = (b.x - a.x) / 2;
  let h = (b.y - a.y) / 2;
  if (equal) {
    const s = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * s;
    h = Math.sign(h || 1) * s;
  }
  return { cx: a.x + w, cy: a.y + h, rx: Math.abs(w), ry: Math.abs(h) };
}

// Convert geometry drawn in image pixels to box coordinates of (row, col).
export function geomToBox(shape: RoiShape, geom: RoiGeom, grid: Grid, row: number, col: number): RoiGeom {
  if (shape === 'polygon') return { points: (geom as PolygonGeom).points.map((p) => toBox(grid, p, row, col)) };
  geom = geom as ShapeGeom;
  const c = toBox(grid, { x: geom.cx, y: geom.cy }, row, col);
  const ex = toBox(grid, { x: geom.cx + geom.rx, y: geom.cy }, row, col);
  const ey = toBox(grid, { x: geom.cx, y: geom.cy + geom.ry }, row, col);
  return { cx: c.x, cy: c.y, rx: Math.abs(ex.x - c.x), ry: Math.abs(ey.y - c.y) };
}

// ---------------------------------------------------------------- editing helpers

// Image point → the region's own coordinates in copy (row, col).
export function roiToLocal(roi: Pick<Roi, 'replicate' | 'offsets'>, grid: Grid, row: number, col: number, p: Point): Point {
  if (!roi.replicate) return { x: p.x, y: p.y };
  const q = toBox(grid, p, row, col);
  const o = boxOffset(roi, row, col);
  return { x: q.x - o.dx, y: q.y - o.dy };
}

// The region's own coordinates in copy (row, col) → image point.
export function roiFromLocal(roi: Pick<Roi, 'replicate' | 'offsets'>, grid: Grid, row: number, col: number, q: Point): Point {
  if (!roi.replicate) return { x: q.x, y: q.y };
  const o = boxOffset(roi, row, col);
  return fromBox(grid, { x: q.x + o.dx, y: q.y + o.dy }, row, col);
}

// Editable points of a shape in its own coordinates: bounding-box corners for
// ellipses/rects, vertices for polygons.
export function roiControlPoints(roi: ShapedGeom): Point[] {
  const g = roi.geom as ShapeGeom;
  if (roi.shape === 'polygon') return (roi.geom as PolygonGeom).points;
  return [
    { x: g.cx - g.rx, y: g.cy - g.ry },
    { x: g.cx + g.rx, y: g.cy - g.ry },
    { x: g.cx + g.rx, y: g.cy + g.ry },
    { x: g.cx - g.rx, y: g.cy + g.ry },
  ];
}

// Size of one grid box in pixels (box coordinates span 1 × 1).
export function gridBoxSize(grid: Grid) {
  const c = grid.corners!;
  return {
    w: Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y) / grid.cols,
    h: Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y) / grid.rows,
  };
}

// Like boxGeom(a, b, true) but equal in pixels when one unit is w × h pixels,
// so Shift gives a real circle/square for regions stored in box coordinates.
export function equalBoxGeom(a: Point, b: Point, { w, h }: { w: number; h: number }): ShapeGeom {
  const s = Math.max(Math.abs(b.x - a.x) * w, Math.abs(b.y - a.y) * h) / 2;
  const rx = s / w;
  const ry = s / h;
  return { cx: a.x + Math.sign(b.x - a.x || 1) * rx, cy: a.y + Math.sign(b.y - a.y || 1) * ry, rx, ry };
}

export function translateGeom(shape: RoiShape, geom: RoiGeom, dx: number, dy: number): RoiGeom {
  if (shape === 'polygon') return { points: (geom as PolygonGeom).points.map((q) => ({ x: q.x + dx, y: q.y + dy })) };
  return { ...geom, cx: (geom as ShapeGeom).cx + dx, cy: (geom as ShapeGeom).cy + dy } as ShapeGeom;
}

// ---------------------------------------------------------------- bounds
// Limits are {x0, y0, x1, y1}: [0, 1]² for a box copy, the grid or image in
// pixels for a single region.

export function boundsOf(points: Point[]): Box {
  const b: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of points) {
    b.x0 = Math.min(b.x0, p.x);
    b.y0 = Math.min(b.y0, p.y);
    b.x1 = Math.max(b.x1, p.x);
    b.y1 = Math.max(b.y1, p.y);
  }
  return b;
}

const clampTo = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function clampPoint(p: Point, lim: Box): Point {
  return { x: clampTo(p.x, lim.x0, lim.x1), y: clampTo(p.y, lim.y0, lim.y1) };
}

// Shift (dx, dy) cut back so that bounds b moved by it stay inside lim. A
// shape larger than lim is pinned to lim's top-left edge.
export function clampShift(b: Box, dx: number, dy: number, lim: Box) {
  return {
    dx: Math.max(Math.min(dx, lim.x1 - b.x1), lim.x0 - b.x0),
    dy: Math.max(Math.min(dy, lim.y1 - b.y1), lim.y0 - b.y0),
  };
}

// Geometry moved and, if needed, shrunk about its centre so it fits in lim.
export function fitGeom(shape: RoiShape, geom: RoiGeom, lim: Box): RoiGeom {
  const pts = shape === 'polygon' ? (geom as PolygonGeom).points : roiControlPoints({ shape, geom });
  const b = boundsOf(pts);
  const k = Math.min(1, (lim.x1 - lim.x0) / (b.x1 - b.x0 || 1), (lim.y1 - lim.y0) / (b.y1 - b.y0 || 1));
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const scale = (p: Point) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k });
  const g: RoiGeom = shape === 'polygon' ? { points: (geom as PolygonGeom).points.map(scale) } : { ...geom, rx: (geom as ShapeGeom).rx * k, ry: (geom as ShapeGeom).ry * k };
  const sb = { x0: cx - (cx - b.x0) * k, y0: cy - (cy - b.y0) * k, x1: cx + (b.x1 - cx) * k, y1: cy + (b.y1 - cy) * k };
  const { dx, dy } = clampShift(sb, 0, 0, lim);
  return translateGeom(shape, g, dx, dy);
}

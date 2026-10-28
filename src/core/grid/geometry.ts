// Bilinear grid geometry: corners, anchors, cell lookup and sample bounds.

import type { Corners, Grid, Point, UV } from '../../types/index.ts';

export function rectCorners(p1: Point, p2: Point): Corners {
  const x0 = Math.min(p1.x, p2.x);
  const x1 = Math.max(p1.x, p2.x);
  const y0 = Math.min(p1.y, p2.y);
  const y1 = Math.max(p1.y, p2.y);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

export function bilinear(corners: Corners, u: number, v: number): Point {
  const [tl, tr, br, bl] = corners;
  const a = (1 - u) * (1 - v);
  const b = u * (1 - v);
  const c = u * v;
  const d = (1 - u) * v;
  return {
    x: a * tl.x + b * tr.x + c * br.x + d * bl.x,
    y: a * tl.y + b * tr.y + c * br.y + d * bl.y,
  };
}

// Inverse bilinear mapping by Newton iteration. Returns {u, v}; values
// outside [0, 1] mean the point lies outside the grid.
export function invertBilinear(corners: Corners, p: Point): UV {
  const [tl, tr, br, bl] = corners;
  let u = 0.5;
  let v = 0.5;
  for (let i = 0; i < 20; i++) {
    const q = bilinear(corners, u, v);
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    if (Math.abs(ex) < 1e-6 && Math.abs(ey) < 1e-6) break;
    const dxdu = (1 - v) * (tr.x - tl.x) + v * (br.x - bl.x);
    const dydu = (1 - v) * (tr.y - tl.y) + v * (br.y - bl.y);
    const dxdv = (1 - u) * (bl.x - tl.x) + u * (br.x - tr.x);
    const dydv = (1 - u) * (bl.y - tl.y) + u * (br.y - tr.y);
    const det = dxdu * dydv - dxdv * dydu;
    if (Math.abs(det) < 1e-12) break;
    u -= (ex * dydv - ey * dxdv) / det;
    v -= (ey * dxdu - ex * dydu) / det;
  }
  return { u, v };
}

// A grid's clicked points are either its outer corners (anchor 'corners', the
// default) or the centers of its four corner cells (anchor 'centers', for dot
// plots without cell borders). Everything below works on the outer corners.
const isCenters = (grid: Grid) => grid.anchor === 'centers';

// Outer corners: for centers, extrapolate half a cell beyond the corner
// cells' centers. A single row or column has no spacing, so it gets none.
export function outerCorners(grid: Grid): Corners {
  if (!isCenters(grid)) return grid.corners!;
  const su = grid.cols > 1 ? 0.5 / (grid.cols - 1) : 0;
  const sv = grid.rows > 1 ? 0.5 / (grid.rows - 1) : 0;
  const c = grid.corners!;
  return [bilinear(c, -su, -sv), bilinear(c, 1 + su, -sv), bilinear(c, 1 + su, 1 + sv), bilinear(c, -su, 1 + sv)];
}

// The inverse: centers of the four corner cells of a grid given by its outer corners.
export function cornerCellCenters(outer: Corners, rows: number, cols: number): Corners {
  const su = 0.5 / cols;
  const sv = 0.5 / rows;
  return [
    bilinear(outer, su, sv),
    bilinear(outer, 1 - su, sv),
    bilinear(outer, 1 - su, 1 - sv),
    bilinear(outer, su, 1 - sv),
  ];
}

export function cellAt(grid: Grid, p: Point) {
  const { u, v } = invertBilinear(outerCorners(grid), p);
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
  return { row: Math.floor(v * grid.rows), col: Math.floor(u * grid.cols) };
}

// Normalized bounds of the sampled (central) part of a cell. With a dot
// radius (centers mode, in image pixels) the bounds follow the dot: a circle
// of sampleFraction × radius, or the square inscribed in it.
export function cellSampleBounds(grid: Grid, row: number, col: number, radius: number | null = null) {
  const uc = (col + 0.5) / grid.cols;
  const vc = (row + 0.5) / grid.rows;
  let hu = grid.sampleFraction / 2 / grid.cols;
  let hv = grid.sampleFraction / 2 / grid.rows;
  if (radius) {
    const { width, height } = gridPixelSize(outerCorners(grid));
    const r = radius * grid.sampleFraction * (grid.shape === 'circle' ? 1 : Math.SQRT1_2);
    hu = r / width;
    hv = r / height;
  }
  return { u0: uc - hu, u1: uc + hu, v0: vc - hv, v1: vc + hv };
}

const CIRCLE_POINTS = 32;

export function cellSamplePolygon(grid: Grid, row: number, col: number, radius: number | null = null) {
  const { u0, u1, v0, v1 } = cellSampleBounds(grid, row, col, radius);
  const c = outerCorners(grid);
  if (grid.shape === 'circle') {
    const uc = (u0 + u1) / 2;
    const vc = (v0 + v1) / 2;
    return Array.from({ length: CIRCLE_POINTS }, (_, i) => {
      const a = (i / CIRCLE_POINTS) * 2 * Math.PI;
      return bilinear(c, uc + ((u1 - u0) / 2) * Math.cos(a), vc + ((v1 - v0) / 2) * Math.sin(a));
    });
  }
  return [bilinear(c, u0, v0), bilinear(c, u1, v0), bilinear(c, u1, v1), bilinear(c, u0, v1)];
}

// Pixel width and height of a grid: its longer pair of opposite sides.
export function gridPixelSize(corners: Corners) {
  const c = corners;
  return {
    width: Math.max(Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y), Math.hypot(c[2].x - c[3].x, c[2].y - c[3].y)),
    height: Math.max(Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y), Math.hypot(c[2].x - c[1].x, c[2].y - c[1].y)),
  };
}

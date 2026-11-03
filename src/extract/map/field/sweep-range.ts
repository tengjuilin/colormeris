// Map tool, sweep geometry (pure): how far a profile line can move across the plot area along its normal
// (sweepRange), used by the Profiles card's Sweep (cards/sweep.ts).

import { invertBilinear } from '../../../core/grid.ts';
import type { Corners, ErrorResult, Point } from '../../../types/index.ts';

// How far the line a–b can move along its normal n (unit, to the right of
// a → b in page coordinates) and stay inside the plot area (corners):
// {n, min, max} in page px, min ≤ 0 ≤ max, or {error}. The midpoint must
// stay inside, and so must each end that starts inside; an end drawn a
// little past the edge (a line from edge to edge) does not block the sweep.
// With runOff the line may leave the area until no part of it is left:
// a wider sweep for slanted lines, whose ends leave first.
export function sweepRange(
  corners: Corners | null,
  a: Point,
  b: Point,
  { runOff = false }: { runOff?: boolean } = {},
): { n: Point; min: number; max: number } | ErrorResult {
  if (!corners) return { error: 'Place the plot area first.' };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return { error: 'Profile is too short.' };
  const n = { x: -dy / len, y: dx / len };
  if (runOff) return runOffRange(corners, a, { x: dx / len, y: dy / len }, n, len);
  const inside = (p: Point) => {
    const { u, v } = invertBilinear(corners, p);
    return u >= -1e-9 && u <= 1 + 1e-9 && v >= -1e-9 && v <= 1 + 1e-9;
  };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (!inside(mid)) return { error: 'Move the profile inside the plot area to sweep it.' };
  // The area is convex, so each point stays inside over one interval of
  // offsets; the farthest it can go is the area's diagonal.
  const far =
    Math.hypot(corners[2].x - corners[0].x, corners[2].y - corners[0].y) +
    Math.hypot(corners[3].x - corners[1].x, corners[3].y - corners[1].y);
  const reach = (p: Point, sign: number) => {
    let lo = 0;
    let hi = far;
    for (let i = 0; i < 50; i++) {
      const s = (lo + hi) / 2;
      if (inside({ x: p.x + sign * s * n.x, y: p.y + sign * s * n.y })) lo = s;
      else hi = s;
    }
    return lo;
  };
  const points = [mid, a, b].filter(inside);
  return { n, min: -Math.min(...points.map((p) => reach(p, -1))), max: Math.min(...points.map((p) => reach(p, 1))) };
}

// The offsets along n at which the line (from a along d, len long) still
// touches the area: the area clipped to the strip the line sweeps, measured
// across. The plot area's edges are straight, so it is a polygon.
function runOffRange(
  corners: Corners,
  a: Point,
  d: Point,
  n: Point,
  len: number,
): { n: Point; min: number; max: number } | ErrorResult {
  let poly = corners.map((p) => ({
    along: (p.x - a.x) * d.x + (p.y - a.y) * d.y,
    across: (p.x - a.x) * n.x + (p.y - a.y) * n.y,
  }));
  poly = clipPolygon(poly, (q) => q.along);
  poly = clipPolygon(poly, (q) => len - q.along);
  if (!poly.length) return { error: 'Move the profile onto the plot area to sweep it.' };
  const across = poly.map((q) => q.across);
  const min = Math.min(...across);
  const max = Math.max(...across);
  if (min > 1e-9 || max < -1e-9) return { error: 'Move the profile onto the plot area to sweep it.' };
  return { n, min: Math.min(0, min), max: Math.max(0, max) };
}

interface AlongAcross {
  along: number;
  across: number;
}

// The part of a convex polygon [{along, across}] where f ≥ 0 (Sutherland–Hodgman).
function clipPolygon(poly: AlongAcross[], f: (q: AlongAcross) => number) {
  const out: AlongAcross[] = [];
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const fp = f(p);
    const fq = f(q);
    if (fp >= 0) out.push(p);
    if (fp >= 0 !== fq >= 0) {
      const t = fp / (fp - fq);
      out.push({ along: p.along + t * (q.along - p.along), across: p.across + t * (q.across - p.across) });
    }
  });
  return out;
}

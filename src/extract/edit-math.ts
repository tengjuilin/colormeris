// Small pure helpers for editing on the image, shared by the workspace and the tools: names for new items,
// the Shift axis lock of a move, and where a point lies against a line segment (hit tests, tracing).
import type { Point } from '../types/index.ts';

/** `${prefix} n` with the smallest n ≥ 1 that is not in `used` ("ROI 3", "Profile 2"). */
export function nextName(prefix: string, used: Iterable<string>): string {
  const taken = new Set(used);
  let n = 1;
  while (taken.has(`${prefix} ${n}`)) n++;
  return `${prefix} ${n}`;
}

/** A move (dx, dy) kept to its larger component while `lock` (Shift) is held: straight across or down. */
export function lockAxis(dx: number, dy: number, lock: boolean): { dx: number; dy: number } {
  if (!lock) return { dx, dy };
  return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };
}

/**
 * Where p lies against the segment a–b: t is its projection along a → b (0 at a, 1 at b, not clamped) and
 * across its distance from the infinite line through a and b. A segment of no length projects to t = 0.
 */
export function segmentProjection(p: Point, a: Point, b: Point): { t: number; across: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return { t: 0, across: Math.hypot(p.x - a.x, p.y - a.y) };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  return { t, across: Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / Math.sqrt(len2) };
}

/** Distance from p to the nearest point of the segment a–b. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const t = Math.min(1, Math.max(0, segmentProjection(p, a, b).t));
  return Math.hypot(a.x + t * (b.x - a.x) - p.x, a.y + t * (b.y - a.y) - p.y);
}

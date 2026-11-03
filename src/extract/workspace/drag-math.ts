// Pure maths of the shared handle drags (interact.ts): a grid corner dragged with the box kept a rectangle,
// and where the colorbar's ticks go while one of its ends is dragged.
import { rectCorners } from '../../core/grid.ts';
import type { BarTickMode, Corners, Point } from '../../types/index.ts';

/**
 * Corner `i` dragged to p with the box kept a rectangle: the rectangle from p to the opposite corner, and the
 * index of the corner now under the pointer (it changes when p crosses the opposite corner's x or y).
 */
export function dragRectCorner(corners: Corners, i: number, p: Point): { corners: Corners; i: number } {
  const next = rectCorners(p, corners[(i + 2) % 4]);
  return { corners: next, i: next.findIndex((q) => q.x === p.x && q.y === p.y) };
}

/**
 * Tick positions t (0 at the start, 1 at the end) after one end of a bar of length `len0` was dragged until
 * the bar is `len` long; `ts0` are the ticks' t when the drag started. "follow": ticks keep their relative
 * position. "fixed": they keep their distance from the end that is not dragged.
 */
export function barTicksAfterDrag(
  ts0: readonly number[],
  len0: number,
  len: number,
  dragged: 'start' | 'end',
  mode: BarTickMode,
): number[] {
  if (mode === 'follow') return [...ts0];
  const L = len || 1e-9;
  return ts0.map((t0) => (dragged === 'end' ? (t0 * len0) / L : 1 - ((1 - t0) * len0) / L));
}

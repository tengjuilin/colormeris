// snapEdges: moves the edges of a trusted box onto the cells.

import type { Box, PixelImage } from '../../types/index.ts';
import { clamp } from './helpers.ts';
import { fitFrame, lineTools } from './line-tools.ts';
import { snapBlock } from './snap-block.ts';

// Edges only, for a box the caller trusts (an LLM read it off the page
// rulers): each edge moves to the edge of the cells within `tol`
// (default 3% of the box, at least 4 px), so the box cannot grow into
// labels, a dendrogram or a colorbar beside the cells; only an edge that
// lies inside the cells goes further out, to snapBlock's edge.
// snapBlock's edge is taken where it lies within `tol`; otherwise the
// edge is refined on its own. A line is full when half of it is off the page; the edge goes to the
// nearest place where three full lines follow a nearly blank one, then
// onto the middle of a frame as snapBlock does. An edge with no such
// change near it (a row of white cells) stays put.
export function snapEdges(img: PixelImage, box: Box, { tol = null }: { tol?: number | null } = {}): Box | null {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  if (!(w > 2 && h > 2)) return null;
  const tx = tol ?? Math.max(4, Math.round(0.03 * w));
  const ty = tol ?? Math.max(4, Math.round(0.03 * h));
  const T = lineTools(
    img,
    clamp(Math.round(box.x0 - tx - 10), 0, img.width - 1),
    clamp(Math.round(box.y0 - ty - 10), 0, img.height - 1),
    clamp(Math.round(box.x1 + tx + 10), 1, img.width),
    clamp(Math.round(box.y1 + ty + 10), 1, img.height),
    { x0: box.x0 + 0.2 * w, y0: box.y0 + 0.2 * h, x1: box.x1 - 0.2 * w, y1: box.y1 - 0.2 * h },
  );
  // One edge: `edge` is the box's outermost line, `dir` points inward.
  const fit = (horizontal: boolean, edge: number, dir: number, s0: number, s1: number, t: number, size: number) => {
    const end = horizontal ? img.width : img.height;
    const L = T.line(horizontal, s0 + 0.1 * (s1 - s0), s1 - 0.1 * (s1 - s0), 400);
    const ok = (a: number) => a >= 0 && a < end;
    const full = (a: number) => ok(a) && L.share(a, T.faint) >= 0.5;
    const blank = (a: number) => !ok(a) || L.share(a, T.faint) < 0.2;
    edge = clamp(Math.round(edge), 0, end - 1);
    // Places where the cells start (a blank line within 3 lines outside,
    // then 3 full lines), the nearest to the caller's edge wins (not a
    // bracket or labels further out).
    let best = null;
    for (let a = edge - dir * t; dir * (a - (edge + dir * t)) <= 0; a += dir) {
      if (full(a - dir) || ![1, 2, 3].some((i) => blank(a - dir * i)) || ![0, 1, 2].every((i) => full(a + dir * i)))
        continue;
      if (best === null || Math.abs(a - edge) < Math.abs(best - edge)) best = a;
    }
    return best === null ? edge : fitFrame(T, horizontal, best, dir, s0, s1, size, end);
  };
  // snapBlock's edges where they agree with the box; elsewhere the box
  // is trusted and only refined nearby. An edge inside the cells (its line
  // and the two outside it full of color: the LLM read t1's Average row
  // 12 px short) takes snapBlock's edge further out, up to 30% of the box.
  const snap: Partial<Box> = snapBlock(img, box) || {};
  const near = (v: number | undefined, e: number, t: number) => (Math.abs((v as number) - e) <= t ? v : null);
  const cut = (horizontal: boolean, edge: number, dir: number, s0: number, s1: number, size: number, v: number) => {
    if (!Number.isFinite(v) || dir * (edge - v) <= 0 || dir * (edge - v) > 0.3 * size) return null;
    const L = T.line(horizontal, s0 + 0.1 * (s1 - s0), s1 - 0.1 * (s1 - s0), 400);
    return [0, 1, 2].every((i) => L.share(Math.round(edge) - dir * i, T.faint) >= 0.5) ? v : null;
  };
  const x0 =
    near(snap.x0, box.x0, tx) ??
    cut(true, box.x0, 1, box.y0, box.y1, w, snap.x0 as number) ??
    fit(true, box.x0, 1, box.y0, box.y1, tx, w);
  const x1 =
    near(snap.x1, box.x1, tx) ??
    cut(true, box.x1 - 1, -1, box.y0, box.y1, w, snap.x1 as number) ??
    fit(true, box.x1 - 1, -1, box.y0, box.y1, tx, w) + 1;
  const y0 =
    near(snap.y0, box.y0, ty) ??
    cut(false, box.y0, 1, x0, x1, h, snap.y0 as number) ??
    fit(false, box.y0, 1, x0, x1, ty, h);
  const y1 =
    near(snap.y1, box.y1, ty) ??
    cut(false, box.y1 - 1, -1, x0, x1, h, snap.y1 as number) ??
    fit(false, box.y1 - 1, -1, x0, x1, ty, h) + 1;
  return { x0, y0, x1, y1 };
}

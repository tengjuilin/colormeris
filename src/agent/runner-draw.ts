// Pure layout maths of the runner's page images (runner.ts draws them): the
// ruler step, the note that maps image pixels back to the page, and where
// the numbered marks and their labels go.

import type { Box, Point } from '../types/index.ts';
import { round } from './round.ts';

// Round step (1, 2 or 5 × 10^k) so ruler labels are ~`px` screen pixels apart.
export function niceStep(scale: number, px = 70) {
  const raw = px / scale;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw)!;
}

// The note of a ruled view: which region, at what scale, and how image
// pixels convert to page pixels.
export function viewNote({
  page,
  region: { x0, y0, x1, y1 },
  scale,
  width,
  height,
}: {
  page: number;
  region: Box;
  scale: number;
  width: number;
  height: number;
}) {
  const r = (v: number) => round(v, 2);
  return `Page ${page}, region x ${r(x0)}–${r(x1)}, y ${r(y0)}–${r(y1)}, drawn at ${r(scale)}× (${width} × ${height} image pixels plus rulers). Image pixel (0, 0) is page point (${r(x0)}, ${r(y0)}): page x = ${r(x0)} + image x / ${r(scale)}, page y = ${r(y0)} + image y / ${r(scale)}. The rulers on the bottom and right edges show the same page pixels.`;
}

// Each mark's box in image pixels (3 px outside the page box).
export function markBoxes(boxes: Box[], toView: (p: Point) => Point): Box[] {
  return boxes.map((box) => {
    const p = toView({ x: box.x0, y: box.y0 });
    const q = toView({ x: box.x1, y: box.y1 });
    return { x0: p.x - 3, y0: p.y - 3, x1: q.x + 3, y1: q.y + 3 };
  });
}

// Where the label of mark `b` (a tag `tw` wide, 20 high) goes: on the right
// unless that leaves the image or covers a mark (labels side by side under
// a horizontal colorbar, where a number hid the next label's first digit),
// then below, above or left; on the right when all of them do.
export function labelPlace(b: Box, tw: number, all: Box[], width: number, height: number): Box {
  const hits = (r: Box) =>
    r.x0 < 0 ||
    r.y0 < 0 ||
    r.x1 > width ||
    r.y1 > height ||
    all.some((o) => r.x0 < o.x1 + 2 && r.x1 > o.x0 - 2 && r.y0 < o.y1 + 2 && r.y1 > o.y0 - 2);
  const cx = (b.x0 + b.x1) / 2 - tw / 2;
  const cy = (b.y0 + b.y1) / 2 - 10;
  const places = [
    { x0: b.x1 + 2, y0: cy },
    { x0: cx, y0: b.y1 + 2 },
    { x0: cx, y0: b.y0 - 22 },
    { x0: b.x0 - tw - 2, y0: cy },
  ].map((r) => ({ ...r, x1: r.x0 + tw, y1: r.y0 + 20 }));
  return places.find((r) => !hits(r)) || places[0];
}

// Snapping the decision model's two boxes to the heatmap's cells.

import { fitCellCounts, rectCorners } from '../../core/grid.ts';
import { snapBlock, snapEdges } from '../../core/locate.ts';
import type { Box, PixelImage } from '../../types/index.ts';
import { FAIR_FIT } from './grid-plan.ts';

const area = (b: Box) => (b.x1 - b.x0) * (b.y1 - b.y0);
const holds = (a: Box, b: Box) => a.x0 <= b.x0 + 3 && a.y0 <= b.y0 + 3 && a.x1 >= b.x1 - 3 && a.y1 >= b.y1 - 3;
export const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// The cells from the decision model's two boxes, snapped to pixels
// (core/locate.js snapBlock): `rough` on the whole page, `boxed` on a
// crop around it. A crop box on a pale edge column has no solid core to
// snap from; the page-wide box then still reaches the block. A short crop
// box can also stop the snap at a pale row (the 24h cytokine heatmap: 6 of
// 32 rows); a page-wide snap that holds it and is much larger then wins,
// unless it outgrew Jev's page box (a neighbouring heatmap joined in). The
// other way round, a crop snap that holds the page-wide one and is far
// larger than Jev's page box took in a block next to it (a strip and the
// block 20 px below it). A snap far smaller than Jev's page box caught one
// corner of the heatmap (once on a 12 × 32 heatmap: 2 × 2 cells):
// `partial`, and the LLM re-locates. A snap that lost more than 15% of
// the crop box, or moved an edge more than 8% of it inward, may have
// stopped at pale cells (t16, t18: 22% and 65% of the box): the crop box
// with only its edges refined (snapEdges) is tried too and wins when its
// cells fit an even grid clearly better (fitQuality) and its edges were
// found on the pixels. Returns {cells (null
// when nothing snapped), partial, edges (true when the refined box won)}.
export function snapCells(img: PixelImage, rough: Box, boxed: Box) {
  const near = snapBlock(img, boxed);
  const wide = snapBlock(img, rough);
  let cells = near || wide;
  if (near && wide && holds(wide, near) && area(near) < 0.6 * area(wide) && area(wide) < 1.5 * area(rough))
    cells = wide;
  if (near && wide && holds(near, wide) && area(near) > 1.5 * area(rough) && area(wide) <= 1.5 * area(rough))
    cells = wide;
  let edges = false;
  if (cells && shrunk(cells, boxed)) {
    // (Only a box whose edges found the cells' edges: at least 3 of them
    // moved. One that stayed put is the crop box with its white margin.)
    let alt = snapEdges(img, boxed);
    if (alt && (['x0', 'y0', 'x1', 'y1'] as const).filter((k) => Math.abs(alt![k] - boxed[k]) >= 1).length < 3)
      alt = null;
    const [q, qa] = [fitQuality(img, cells), alt && fitQuality(img, alt)];
    // It must add whole cells: each side it moves out by more than 3 px
    // gains half a cell or more (t10: 12 px of row labels past 42 px cells
    // fit as well and are no cells).
    const cellsOnly = (b: Box) =>
      (['x0', 'x1', 'y0', 'y1'] as const).every((k) => {
        const out = k.endsWith('0') ? cells![k] - b[k] : b[k] - cells![k];
        return out <= 3 || out >= 0.5 * (k[0] === 'x' ? q.colSize : q.rowSize);
      });
    if (qa && qa.min >= FAIR_FIT && qa.mean >= q.mean + 0.1 && cellsOnly(alt!)) [cells, edges] = [alt!, true];
  }
  return { cells, partial: !!cells && area(cells) < 0.3 * area(rough), edges };
}

// Whether a snap lost much of a box: under 85% of its area, or an edge
// more than 8% of the box inside it.
function shrunk(cells: Box, box: Box) {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const inward = Math.max(
    (cells.x0 - box.x0) / w,
    (box.x1 - cells.x1) / w,
    (cells.y0 - box.y0) / h,
    (box.y1 - cells.y1) / h,
  );
  return area(cells) < 0.85 * area(box) || inward > 0.08;
}

// How well a box of cells fits an even grid (fitCellCounts' scores on
// both axes): {min, mean, rowSize, colSize}.
function fitQuality(img: PixelImage, b: Box) {
  const f = fitCellCounts(img, rectCorners({ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }));
  return {
    min: Math.min(f.rowScore, f.colScore),
    mean: (f.rowScore + f.colScore) / 2,
    rowSize: f.rowSize,
    colSize: f.colSize,
  };
}

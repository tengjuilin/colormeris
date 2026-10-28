// Pixel-level finishing for rough boxes. A decision model such as Jev boxes
// the cells of a heatmap or its colorbar to a few percent of the image;
// these functions find the real block of color inside such a box and the
// tick labels beside a colorbar strip. Boxes are {x0, y0, x1, y1} in image
// pixels (x1, y1 exclusive).
//
// The code lives in src/core/locate/, one file per concern; this file only
// re-exports it:
//   types.ts        Bar, StripKind, BarCandidate and shared internal types
//   helpers.ts      thresholds, page background, ink tests, connected components
//   line-tools.ts   line measures around a box, frame fitting
//   snap-block.ts   snapBlock (the filled block of cells)
//   snap-edges.ts   snapEdges (edges of a trusted box)
//   bar-strips.ts   colorbar pixel tests, following a strip to its ends
//   colorbars.ts    findColorbars, snapStrip, snapStripBox, findStrip
//   tick-labels.ts  findTickLabels (the labels beside a strip)
//   tick-marks.ts   binEdges and the marks built from a label side
//   label-reach.ts  labelReach (how far labels extend from the cells)

export { findColorbars, findStrip, snapStrip, snapStripBox } from './locate/colorbars.ts';
export { labelReach } from './locate/label-reach.ts';
export { snapBlock } from './locate/snap-block.ts';
export { snapEdges } from './locate/snap-edges.ts';
export { findTickLabels } from './locate/tick-labels.ts';
export { binEdges } from './locate/tick-marks.ts';
export type { Bar, BarCandidate, StripKind, TickLabelsResult } from './locate/types.ts';

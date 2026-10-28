// Heatmap grid geometry and pixel sampling.
// A grid is defined by four points in image pixel space, ordered
// [topLeft, topRight, bottomRight, bottomLeft]: its outer corners, or the
// centers of its corner cells (see outerCorners). Points inside the grid are
// addressed with normalized (u, v) in [0, 1]², u along columns, v along rows.
//
// The code lives in src/core/grid/, one file per concern; this file only
// re-exports it:
//   geometry.ts      bilinear mapping, anchors, cell lookup and sample bounds
//   sampling.ts      readPixel, sampleCell, dotRadius
//   text.ts          suppressText (text printed in cells)
//   size-detect.ts   detectGridSize and its edge profile / period helpers
//   fit-evidence.ts  border evidence along an axis (for fitCellCounts)
//   fit-comb.ts      comb fitting of even cell spacing
//   fit-counts.ts    fitCellCounts

export { fitCellCounts } from './grid/fit-counts.ts';
export {
  bilinear,
  cellAt,
  cellSampleBounds,
  cellSamplePolygon,
  cornerCellCenters,
  gridPixelSize,
  invertBilinear,
  outerCorners,
  rectCorners,
} from './grid/geometry.ts';
export { dotRadius, readPixel, sampleCell } from './grid/sampling.ts';
export {
  autocorrelation,
  bestCount,
  countCells,
  detectGridSize,
  edgeProfile,
  scorePeriod,
} from './grid/size-detect.ts';
export { suppressText } from './grid/text.ts';

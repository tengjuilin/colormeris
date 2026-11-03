// Colorbars, split by concern behind this barrel so importers don't change:
//   colorbar/calibration.ts  sampleColorbar, projectT, pointAtT, SCALES and the
//                            scale tests, piecewiseScaleFor, tickProblem,
//                            makeValueFn, colorbarSamples, labToT, colorAtT
//   colorbar/bins.ts         binned bars: colorbarBins, labelBins, nearestBin
//   colorbar/status.ts       colorStatus (ok / flagged / clamped / off-map)
//   colorbar/snap.ts         refineColorbar, snapTick
export { colorbarBins, labelBins, nearestBin } from './colorbar/bins.ts';
export {
  colorAtT,
  colorbarSamples,
  DEFAULT_SAMPLES,
  isLogScale,
  isPiecewiseScale,
  labToT,
  makeValueFn,
  piecewiseScaleFor,
  pointAtT,
  projectT,
  SCALES,
  sampleColorbar,
  tickProblem,
} from './colorbar/calibration.ts';
export { type RefinedColorbar, refineColorbar, snapTick } from './colorbar/snap.ts';
export { type ColorStatus, colorStatus } from './colorbar/status.ts';

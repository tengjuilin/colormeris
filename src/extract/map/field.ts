// Map tool: read a near-continuous field (spectroscopy maps, fluorescence
// images) as a dense value matrix. The plot area is the panel's grid corners;
// it is sampled in square bins of map.bin rendered pixels (1 = native), each
// bin the per-channel median of its pixels. Optional axis ticks turn bin
// centres into axis coordinates; without them, coordinates are pixel offsets
// from the plot's top-left corner (or scale-bar lengths).
//
// The code lives in src/extract/map/field/, one file per concern; this file
// only re-exports it:
//   color-reader.ts  flag bits, the colorbar's samples and cached color reader
//   extract.ts       the value field (extractFieldValues, extractField, extractMap), reconPixels, mapAt
//   coords.ts        axis ticks and values, coordinate units, fieldCoords
//   profiles.ts      sampling profiles, their units and length, pasting copies
//   sweep-range.ts   how far a profile can sweep across the plot area

export { FLAG_DELTA_E, FLAG_HIGH, FLAG_LOW } from './field/color-reader.ts';
export {
  type AxisKey,
  axisCoords,
  axisEdgePoint,
  axisFn,
  axisT,
  coordKind,
  type FieldCoords,
  fieldCoords,
  lengthPerPixel,
  mapCoord,
  onAxisEdge,
} from './field/coords.ts';
export {
  colorbarLevels,
  extractField,
  extractFieldValues,
  extractMap,
  type FieldValues,
  MAX_MAP_CELLS,
  mapAt,
  mapProblem,
  mapSize,
  reconPixels,
  withCoords,
} from './field/extract.ts';
export {
  type ProfileXKind,
  pastedProfiles,
  profileAxisKey,
  profileDivisor,
  profileEndForLength,
  profileLength,
  profileXKind,
  sampleProfile,
  sampleProfiles,
} from './field/profiles.ts';
export { sweepRange } from './field/sweep-range.ts';

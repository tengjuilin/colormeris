// The public API: every name the package's users (the Colormeris viewer among
// them) import from it. Removing or renaming one is a breaking change.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as api from './index.ts';

const NAMES = [
  // color.ts
  'SRGB_TO_LINEAR',
  'srgbToLinear',
  'linearToSrgb',
  'rgbToLab',
  'labToRgb',
  'chroma',
  'hueAngle',
  'labToLch',
  'onWhite',
  'lerpRgb',
  'deltaE76',
  'deltaE2000',
  'colorDistance',
  'rgbToHex',
  'parseHexColors',
  // cvd.ts
  'CVD_TYPES',
  'simulateCvd',
  'CVD_MODELS',
  'ACHROMAT',
  'resolveCvdModel',
  'cvdLinearFn',
  'simulateCvdColor',
  'simulateCvdPixels',
  'lightness',
  'grayscale',
  'lightnessStats',
  // stats.ts
  'median',
  'medianInPlace',
  'upperMedian',
  'pct',
  // colormap-library.ts
  'cmapData',
  'mapByName',
  'mapColors',
  'libraryMaps',
  // colormap-match.ts
  'MATCH_LEVELS',
  'cmapColorAt',
  'identifyColorbar',
  'identifyColors',
  'matchLevel',
  'suggestColormap',
  'colormapSamples',
  // metrics.ts
  'mapFeatures',
  'perceptualSteps',
  'stepStats',
  'lchOf',
  'lchProfile',
  'resample',
  'minSeparation',
  'separations',
  'READ_DE',
  'readability',
  'colormapMetrics',
  'worstCvd',
  'ratingNotes',
  'ratingMethod',
  'READ_WINDOW',
  // references.ts
  'citeFor',
  'CMAP_REFS',
  'buildRefNumbers',
  // colorbar.ts, colorbar-refine.ts, pixels.ts
  'DEFAULT_SAMPLES',
  'sampleColorbar',
  'projectT',
  'pointAtT',
  'labToT',
  'colorAtT',
  'refineColorbar',
  'readPixel',
];

test('the package exports every public name', () => {
  const missing = NAMES.filter((n) => !(n in api));
  assert.deepEqual(missing, []);
});

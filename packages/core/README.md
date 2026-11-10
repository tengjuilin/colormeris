# colormeris

Colormaps and color science as pure TypeScript functions: a library of 1063 colormaps, CIELAB and ΔE2000, color vision deficiency (CVD) simulation, colormap matching and ratings, and colorbar sampling. It is the engine of the [Colormeris colormap viewer](https://tengjuilin.github.io/colormeris/).

- No DOM and no dependencies. Functions take plain arrays and RGBA buffers, so they run in Node, in workers and in the browser.
- Colors are `[r, g, b]` arrays of 0–255 sRGB. Lab is CIELAB with a D65 white point.
- Images are any `{ width, height, data }` with RGBA bytes, row by row. `ImageData` fits.
- Types are included (`.d.ts`).

## Install

```bash
npm install colormeris
```

The package is ESM only (`import`, not `require`) and needs Node 22.18 or later. The colormap data is a JSON file imported with `with { type: 'json' }`; bundlers that support JSON import attributes (Vite, esbuild, webpack 5) handle it.

## Usage

### The colormap library

```ts
import { cmapData, libraryMaps, mapByName, mapColors, rgbToHex } from 'colormeris';

cmapData.maps.length; // 1063
const viridis = mapByName('viridis'); // { name, group: 'sequential', sub, source: 'matplotlib', kind: 'continuous', colors }
const rgbs = mapColors(viridis!); // 256 colors: [[68, 1, 84], …, [253, 231, 37]]
rgbToHex(rgbs[255]); // '#fde725'
libraryMaps(); // every map as { name, kind, source, rgbs }, for the matchers
```

Continuous maps have 256 colors; qualitative maps keep their listed colors. `mapColors` returns shared arrays: do not change them.

### Color and ΔE

```ts
import { deltaE2000, labToRgb, rgbToLab } from 'colormeris';

const a = rgbToLab([255, 0, 0]);
const b = rgbToLab([250, 10, 10]);
deltaE2000(a, b); // ≈ 1.2
labToRgb([50, 0, 0]); // the gray with L* = 50
```

### Color vision deficiency

```ts
import { grayscale, simulateCvdColor, simulateCvdPixels } from 'colormeris';

simulateCvdColor([255, 0, 0], 'deuteranopia'); // [163, 144, 0]
simulateCvdColor([255, 0, 0], 'protanopia', { model: 'brettel', severity: 0.6 });
grayscale([255, 0, 0]); // [127, 127, 127]: the gray of the same L*

// A whole image (alpha is kept). `out` is a new array unless you pass one.
const out = simulateCvdPixels(imageData.data, 'tritanopia');
```

Types are `protanopia`, `deuteranopia`, `tritanopia` and `achromatopsia`. Models are `machado`, `brettel` and `vienot` (protan and deutan only); the default `recommended` uses Brettel 1997 for tritan and Machado 2009 for protan and deutan, as the [DaltonLens review](https://daltonlens.org/opensource-cvd-simulation/) advises. `severity` 1 is dichromacy; lower values are anomalous trichromacy.

### Which colormap is this?

```ts
import { identifyColorbar, identifyColors, libraryMaps, matchLevel, suggestColormap } from 'colormeris';

// Colors sampled along a colorbar, from one end to the other.
const [best] = identifyColorbar(barColors, libraryMaps());
best.name; // 'magma'
best.reversed; // true when the bar runs from the map's end to its start
matchLevel(best.score); // 'exact' (ΔE2000 < 3), 'close' (< 6) or 'none'

// The best map only, named as matplotlib would (lowAtStart: which end has the low values).
suggestColormap(barColors, { lowAtStart: false }); // { name: 'magma', mplName: 'magma', reversed: false, level: 'exact', … }

// Loose colors, e.g. the pixels of a heatmap without its colorbar (no direction).
identifyColors(pixels, libraryMaps())[0]; // { name, score, coverage }
```

Both matchers return every map, best first. Scores are ΔE2000.

### Ratings

```ts
import { colormapMetrics, mapByName, mapColors, ratingNotes } from 'colormeris';

const m = colormapMetrics(mapColors(mapByName('jet')!));
m.rating; // { uniform: 'no', cvdSafe: 'no', graySafe: 'no', readable: 'yes' }
ratingNotes(m).map((n) => `${n.label}: ${n.text}`);
// ['Uniform: ΔE2000 steps vary by 47% (CV 0.47).', 'CVD-safe: The worst view (protanopia) keeps 24% …', …]
```

Pass `{ kind: 'qualitative' }` or `{ cyclic: true }` as the second argument for those maps. `ratingMethod()` explains each rating and its thresholds in words.

### Colorbar sampling

```ts
import { colorAtT, colormapSamples, labToT, refineColorbar, rgbToLab, sampleColorbar } from 'colormeris';

// Snap a rough line onto the colored strip of a figure, then sample it.
const start = { x: 960, y: 650 };
const end = { x: 960, y: 150 };
const bar = refineColorbar(img, start, end) ?? { start, end, halfWidth: 2 };
const samples = sampleColorbar(img, bar.start, bar.end, bar.halfWidth); // 256 × { t, rgb, lab }, t from 0 to 1

// Where along the bar is this color? Turn t into a value with your tick values.
labToT(rgbToLab([33, 145, 140]), samples); // { t, deltaE }
colorAtT(samples, 0.5); // the bar's color halfway

// A known colormap instead of a bar read from the figure.
const viridisSamples = colormapSamples({ name: 'viridis', reversed: false });
```

## Exports

### color.ts

- `rgbToLab`, `labToRgb`: sRGB (0–255) to CIELAB (D65) and back.
- `srgbToLinear`, `linearToSrgb`, `SRGB_TO_LINEAR`: the sRGB transfer function, and a lookup table for whole bytes.
- `chroma`, `hueAngle`, `labToLch`: CIELCh pieces of a Lab color (C*, h° in [0, 360)).
- `deltaE76`, `deltaE2000`: color differences between two Lab colors.
- `colorDistance(name)`: `deltaE76` for `'de76'`, else `deltaE2000`.
- `rgbToHex`, `parseHexColors`: `[r, g, b]` to `'#rrggbb'`; `'rrggbbrrggbb…'` to a list of colors.
- `onWhite`, `lerpRgb`: a channel with alpha composited onto white; linear mix of two colors.

### cvd.ts

- `simulateCvdColor(rgb, type, {model, severity})`: one color as seen with a CVD.
- `simulateCvdPixels(rgba, type, opts)`: an RGBA buffer, with a color cache and chunking (`from`, `to`, `cache`, `out`).
- `simulateCvd(rgb, type)`: Machado 2009 at full severity (the views of the ratings).
- `cvdLinearFn(type, opts)`: the simulation as a function on linear RGB.
- `resolveCvdModel(type, model)`: the model `recommended` picks for a type.
- `CVD_TYPES`, `CVD_MODELS`, `ACHROMAT`: the type and model names.
- `lightness`, `grayscale`: L* of a color; the gray with the same L*.
- `lightnessStats(Ls)`: monotonic, reversals, R² and largest deviation of an L* profile.

### stats.ts

- `median`, `medianInPlace`, `upperMedian`: three medians (sorted copy; in place on a typed array; always one of the inputs).
- `pct(share)`: a share as a whole percentage, e.g. `'26%'`.

### colormap-library.ts

- `cmapData`: the library, `{ sources, maps }`.
- `mapByName(name)`: one map, or `undefined`.
- `mapColors(map)`: its colors as `[r, g, b]`, parsed once and shared.
- `libraryMaps()`: every map as `{ name, kind, source, rgbs }`, in library order.

### colormap-match.ts

- `identifyColorbar(samples, maps, {n, within})`: rank maps for colors along a colorbar, with direction.
- `identifyColors(pixels, maps)`: rank maps for loose colors, with the share of each map covered.
- `suggestColormap(rgbs, {lowAtStart})`: the best library map for a colorbar, with its matplotlib name.
- `matchLevel(score)`, `MATCH_LEVELS`: `'exact'`, `'close'` or `'none'` for a score.
- `colormapSamples({name, reversed}, n)`: a library map as colorbar samples `{ t, rgb, lab }`.
- `cmapColorAt(map, t)`: a map's color at t in [0, 1] (interpolated, or the block for qualitative maps).

### metrics.ts

- `colormapMetrics(rgbs, {kind, cyclic}, features?)`: steps, L*/C*/h profiles, separations, readability and the four ratings.
- `ratingNotes(metrics, {qual})`: one sentence per rating.
- `ratingMethod()`: how each rating is made, with its thresholds.
- `worstCvd(metrics)`: the CVD view that keeps the least separation.
- `mapFeatures(rgbs)`: Lab as seen and in each CVD view, to share between calls.
- `perceptualSteps`, `stepStats`: ΔE2000 between neighbors; their mean, max and coefficient of variation.
- `lchOf`, `lchProfile`: CIELCh of one color or a whole map.
- `resample(list, n)`: n evenly spaced items, first and last kept.
- `minSeparation`, `separations`: the smallest difference between values at least 10% apart, as seen, in each CVD view and in grayscale.
- `readability(rgbs, opts)`: distinguishable levels, flat share and ambiguous share per view.
- `READ_DE`, `READ_WINDOW`: the readability thresholds (3 ΔE2000, 5% of the range).

### references.ts

- `CMAP_REFS`: the references of the maps and methods, `{ text, url }` by key.
- `citeFor(name)`: the reference keys for one map.
- `buildRefNumbers(maps)`: footnote numbers in the viewer's list order.

### colorbar.ts, colorbar-refine.ts, pixels.ts

- `sampleColorbar(img, start, end, halfWidth, n)`: colors along a line, averaged across its width.
- `labToT(lab, samples, distance)`: the position t of a color along a sampled bar, and its ΔE.
- `colorAtT(samples, t)`: the bar's color at t.
- `projectT`, `pointAtT`: a point to t on a line, and back.
- `refineColorbar(img, start, end)`: a rough line snapped onto the colored strip and its ends, or `null`.
- `readPixel(img, x, y)`: one pixel, transparency composited onto white.
- `DEFAULT_SAMPLES`: 256.

### Types

`Point`, `Rgb`, `Lab`, `PixelImage`, `DistanceName`, `ColorbarSample`, `ColormapSource`, `ColormapGroup`, `ColormapEntry`, `PackedColormapEntry`, `ColormapData`, and per module `MatchMap`, `MatchResult`, `LooseMatch`, `LibraryMap`, `MapFeatures`, `ColormapMetrics`, `CvdOptions`, `CvdPixelOptions`, `RefinedColorbar`.

## Colormap data

The maps were exported from these packages, with their colors unchanged: Matplotlib (Hunter 2007), CMasher (van der Velden 2020), Crameri's Scientific colour maps through cmcrameri (Crameri 2023, Zenodo [10.5281/zenodo.8409685](https://doi.org/10.5281/zenodo.8409685)), cmocean (Thyng et al. 2016), colorcet (Kovesi 2015), seaborn (Waskom 2021), CarbonPlan, NCL and SciVisColor (through the `colormaps` Python package), CARTOColors (the `cartocolor` npm package), MATLAB's parula, and R palettes collected by paletteer (Hvitfeldt 2021). `cmapData.sources` lists each source with its version. Please cite the source of the maps you use: `citeFor(name)` gives the keys and `CMAP_REFS` the full references.

## License

TODO: license

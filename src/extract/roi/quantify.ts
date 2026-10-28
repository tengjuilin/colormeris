import { rgbToLab } from '../../core/color.ts';
import { colorbarSamples, labToT, makeValueFn } from '../../core/colorbar.ts';
import { cellAt, readPixel } from '../../core/grid.ts';
import type {
  ErrorResult,
  Panel,
  PixelImage,
  Point,
  Rgb,
  RoiResult,
  RoiRow,
  RoiStats,
  ScaleBar,
} from '../../types/index.ts';
import { boxLabel, colorbarProblem, ticksWithT } from '../project/project.ts';
import { centroid, forEachPixelInPolygon, roiInstances } from './geometry.ts';

/** How one color reads: its value, whether it is signal (not gray background), and its distance to the bar. */
export interface PixelClass {
  value: number;
  signal: boolean;
  deltaE: number;
  flagged: boolean;
}

/** makeClassifier's result: classify(rgb), and classify.pixel(i) for pixel i of `img`, remembered. */
export interface Classifier {
  (rgb: Rgb): PixelClass;
  pixel: (i: number) => PixelClass;
  img: PixelImage;
}

/** One row of the results table: a box (or the whole image) with its region copies by region id. */
export interface RoiTableRow {
  label: string;
  row: number | null;
  col: number | null;
  cells: Map<string, RoiRow>;
}

// Quantify signal inside ROIs of images such as IVIS luminescence overlays:
// colored pixels are read through the calibrated colorbar, grayscale pixels
// (the photograph underneath) are background with value 0.

export function roiPanelProblem(panel: Panel): string | null {
  const bar = colorbarProblem(panel);
  if (bar) return bar;
  if (!panel.rois.length) return 'Draw at least one region (ellipse, rectangle or polygon).';
  if (panel.rois.some((r) => r.replicate) && !panel.grid.corners)
    return 'Place the grid, or turn off "copy to every box" for each region.';
  return null;
}

// Area of one pixel in (unit)² from a scale-bar calibration, or null.
export function pixelArea(scale: ScaleBar | null): number | null {
  if (!scale?.p1 || !scale?.p2 || !(scale.length > 0)) return null;
  const px = Math.hypot(scale.p2.x - scale.p1.x, scale.p2.y - scale.p1.y);
  if (px < 1) return null;
  const perPx = scale.length / px;
  return perPx * perPx;
}

// Classifier for pixels: returns {value, signal, deltaE}. Results are cached
// per color since overlays repeat colors heavily.
export function makeClassifier(img: PixelImage, panel: Panel): Classifier {
  const cb = panel.colorbar;
  const samples = colorbarSamples(img, cb);
  const valueAt = makeValueFn(ticksWithT(cb), cb.scale);
  const { grayChroma, distance, maxDeltaE } = panel.settings;
  const cache = new Map<number, number>();
  const hits: PixelClass[] = [];
  // Index into hits (1-based) of a color, classifying it on first sight.
  const indexOf = (r: number, g: number, b: number) => {
    const key = (r << 16) | (g << 8) | b;
    let k = cache.get(key);
    if (!k) {
      let hit: PixelClass;
      const lab = rgbToLab([r, g, b]);
      if (Math.hypot(lab[1], lab[2]) <= grayChroma) hit = { value: 0, signal: false, deltaE: 0, flagged: false };
      else {
        const { t, deltaE } = labToT(lab, samples, distance);
        hit = { value: valueAt!(t), signal: true, deltaE, flagged: deltaE > maxDeltaE };
      }
      k = hits.push(hit);
      cache.set(key, k);
    }
    return k;
  };
  const classify = ((rgb: Rgb) =>
    hits[indexOf(Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])) - 1]) as Classifier;
  // Same as classify(readPixel(img, x, y)) for pixel i = y * width + x, but
  // remembered per pixel (index into hits, 0 = not read yet): dragging a
  // region re-reads mostly the same pixels, and an array read is much
  // cheaper than the color lookup. 4 bytes per pixel, made on first use.
  let byPixel: Int32Array | null = null;
  classify.pixel = (i: number) => {
    byPixel ??= new Int32Array(img.width * img.height);
    const k = byPixel[i];
    if (k) return hits[k - 1];
    const d = img.data;
    const q = i * 4;
    const a = d[q + 3];
    let n: number;
    if (a === 255) n = indexOf(d[q], d[q + 1], d[q + 2]);
    else {
      const f = a / 255;
      const bg = 255 * (1 - f);
      n = indexOf(Math.round(d[q] * f + bg), Math.round(d[q + 1] * f + bg), Math.round(d[q + 2] * f + bg));
    }
    byPixel[i] = n;
    return hits[n - 1];
  };
  classify.img = img;
  return classify;
}

// Statistics over the pixels of one outline (image pixels).
export function quantifyOutline(
  img: PixelImage,
  outline: Point[],
  classify: Classifier,
  pxArea: number | null,
): RoiStats {
  let areaPx = 0;
  let signalPx = 0;
  let flaggedPx = 0;
  let sum = 0;
  let max = 0;
  const { width } = img;
  const at =
    classify.img === img ? classify.pixel : (i: number) => classify(readPixel(img, i % width, Math.floor(i / width)));
  forEachPixelInPolygon(outline, img.width, img.height, (x, y) => {
    const c = at(y * width + x);
    areaPx++;
    if (!c.signal) return;
    signalPx++;
    if (c.flagged) flaggedPx++;
    sum += c.value;
    if (c.value > max) max = c.value;
  });
  const stats: RoiStats = {
    areaPx,
    signalPx,
    flaggedPx,
    sum,
    mean: areaPx ? sum / areaPx : 0,
    meanSignal: signalPx ? sum / signalPx : 0,
    max,
  };
  if (pxArea) Object.assign(stats, { area: areaPx * pxArea, signalArea: signalPx * pxArea, sumArea: sum * pxArea });
  return stats;
}

// Classifier and per-outline stats, kept per image while the colorbar and
// settings stay the same. Dragging a region recomputes the results every
// frame; without this each frame rebuilt the color cache (labToT for every
// color) and re-read every region, not just the moved one.
interface QuantEntry {
  key: string;
  classify: Classifier;
  stats: Map<string, RoiStats>;
}
const quantCache = new WeakMap<PixelImage, QuantEntry>();
function quantCacheFor(img: PixelImage, panel: Panel): QuantEntry {
  const key = JSON.stringify([panel.colorbar, panel.settings]);
  let hit = quantCache.get(img);
  if (!hit || hit.key !== key) {
    hit = { key, classify: makeClassifier(img, panel), stats: new Map() };
    quantCache.set(img, hit);
  }
  return hit;
}

// The shared classifier for this image, colorbar and settings (also used by
// the signal mask, so it reuses the colors and pixels already read).
export function panelClassifier(img: PixelImage, panel: Panel) {
  return quantCacheFor(img, panel).classify;
}

// One row per ROI copy: {roi, row, col, outline, stats}, or {error}.
export function quantifyPanel(img: PixelImage, panel: Panel): RoiResult | ErrorResult {
  const error = roiPanelProblem(panel);
  if (error) return { error };
  const cache = quantCacheFor(img, panel);
  const classify = cache.classify;
  const pxArea = pixelArea(panel.scale);
  const rows: RoiRow[] = [];
  for (const roi of panel.rois) {
    for (const inst of roiInstances(roi, panel.grid)) {
      let { row, col } = inst;
      // A single region reports under the grid box its centre lies in, if any.
      if (row === null && panel.grid.corners) {
        const cell = cellAt(panel.grid, centroid(inst.outline));
        if (cell) ({ row, col } = cell);
      }
      const statsKey = JSON.stringify([pxArea, inst.outline]);
      let stats = cache.stats.get(statsKey);
      if (!stats) {
        if (cache.stats.size > 5000) cache.stats.clear();
        stats = quantifyOutline(img, inst.outline, classify, pxArea);
        cache.stats.set(statsKey, stats);
      }
      rows.push({ roi, row, col, outline: inst.outline, stats });
    }
  }
  return { rows, pxArea, unit: pxArea ? panel.scale!.unit : null };
}

// ---------------------------------------------------------------- results table

// One statistic of a region measurement, or null when it does not apply
// (e.g. areas in real units without a scale bar).
export function metricValue(stats: RoiStats, metric: keyof RoiStats) {
  const v = stats[metric];
  return v === undefined ? null : v;
}

// Four significant digits, exponent notation for very large or small values.
export function shortNumber(v: number) {
  if (!Number.isFinite(v)) return '';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-2) return v.toExponential(2).replace('e+', 'e');
  return String(Number(v.toPrecision(4)));
}

// Results table: one row per box (or "Image" without a grid), one column per
// region. Boxes in reading order, the image row last.
export function roiTableModel(panel: Panel, result: RoiResult) {
  const rowsByKey = new Map<string, RoiTableRow>();
  const order: string[] = [];
  const keyOf = (r: RoiRow) => (r.row === null ? 'image' : `${r.row},${r.col}`);
  for (const r of result.rows) {
    const key = keyOf(r);
    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, {
        label: r.row === null ? 'Image' : boxLabel(panel.grid, r.row, r.col as number),
        row: r.row,
        col: r.col,
        cells: new Map(),
      });
      order.push(key);
    }
    rowsByKey.get(key)!.cells.set(r.roi.id, r);
  }
  order.sort((a, b) => {
    const ra = rowsByKey.get(a)!;
    const rb = rowsByKey.get(b)!;
    if (ra.row === null) return 1;
    if (rb.row === null) return -1;
    return ra.row - rb.row || (ra.col as number) - (rb.col as number);
  });
  return { rows: order.map((k) => rowsByKey.get(k)!), rois: panel.rois };
}

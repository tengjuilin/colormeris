// Recolor a figure into another colormap (the Recolor tab of index.html).
//   indexColors     each pixel's position t along the calibrated colorbar
//                   and its color distance (ΔE76) to the bar, once per bar
//   recolorPixels   pixels close to the bar get the new map's color at t;
//                   the rest (background, text, axes) keep theirs
//   similarMask     the pixels whose t is near a given one, for the hover
//                   highlight
//   regionMask      the pixels inside the user's rectangles; with one, only
//                   those are recolored, so a background that shares the
//                   bar's colors keeps its own
// Images are ImageData-shaped { width, height, data: RGBA bytes }. Samples
// are sampleColorbar's [{ t, lab }] from the bar's start to its end. The
// Compare tab's test patterns are in app/compare/test-pattern.ts.

import type { MatchMap } from 'colormeris';
import { cmapColorAt, labToT, onWhite, rgbToLab } from 'colormeris';
import type { ColorbarSample, PixelImage, Rgb } from '../types/index.ts';

const INDEX_DE = 'de76'; // fast, and the tolerance is a rough cut anyway
const LUT_N = 4096; // new-map colors precomputed along t

/** indexColors' result: each pixel's position t along the bar and its distance de. */
export interface ColorIndex {
  width: number;
  height: number;
  t: Float32Array;
  de: Float32Array;
}

/** A rectangle in image pixels (regionMask). */
export interface RecolorBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Pixels are processed in chunks so the page can stay responsive on big
// images. Colors are looked up once each: figures have few distinct colors.
export function createIndexer(img: PixelImage, samples: ColorbarSample[]) {
  const n = img.width * img.height;
  const t = new Float32Array(n);
  const de = new Float32Array(n);
  const cache = new Map<number, [number, number]>(); // rgb as one int -> [t, deltaE]
  const d = img.data;
  let i = 0;
  // Neighbors often have the same color (flat areas, background), so the
  // last one is kept at hand and the Map is only asked when it changes.
  let lastKey = -1;
  let last: [number, number] | null | undefined = null;
  function step(maxPixels = Infinity) {
    const end = Math.min(n, i + maxPixels);
    for (; i < end; i++) {
      const o = i * 4;
      let r = d[o];
      let g = d[o + 1];
      let b = d[o + 2];
      const a = d[o + 3];
      // Transparent pixels count as white, as readPixel does.
      if (a < 255) {
        const k = a / 255;
        r = Math.round(onWhite(r, k));
        g = Math.round(onWhite(g, k));
        b = Math.round(onWhite(b, k));
      }
      const key = (r << 16) | (g << 8) | b;
      if (key !== lastKey) {
        last = cache.get(key);
        if (!last) {
          const m = labToT(rgbToLab([r, g, b]), samples, INDEX_DE);
          last = [m.t, m.deltaE];
          cache.set(key, last);
        }
        lastKey = key;
      }
      t[i] = last![0];
      de[i] = last![1];
    }
    return i / n;
  }
  return { index: { width: img.width, height: img.height, t, de }, step, colors: () => cache.size };
}

export function indexColors(img: PixelImage, samples: ColorbarSample[]) {
  const ix = createIndexer(img, samples);
  ix.step();
  return ix.index;
}

// Colors of `map` ({ kind, rgbs }) at LUT_N points along t, as one byte array.
function mapLut(map: MatchMap, reversed = false) {
  const lut = new Uint8ClampedArray(LUT_N * 3);
  for (let i = 0; i < LUT_N; i++) {
    const u = i / (LUT_N - 1);
    const c = cmapColorAt(map, reversed ? 1 - u : u);
    lut[i * 3] = Math.round(c[0]);
    lut[i * 3 + 1] = Math.round(c[1]);
    lut[i * 3 + 2] = Math.round(c[2]);
  }
  return lut;
}

// The new map's color for each bar position t (the order of the sampled
// bar). `flip` turns the bar's t around first, when it was drawn from the
// high end, so the low end of the old map becomes the low end of the new one.
export function newColorAt(
  map: MatchMap,
  t: number,
  { reversed = false, flip = false }: { reversed?: boolean; flip?: boolean } = {},
) {
  const u = flip ? 1 - t : t;
  return cmapColorAt(map, reversed ? 1 - u : u);
}

// Boxes { x, y, w, h } in image pixels → Uint8Array of 0/1 per pixel, or
// null for no boxes (the whole image). Boxes are clipped to the image.
export function regionMask(width: number, height: number, boxes?: RecolorBox[] | null) {
  if (!boxes?.length) return null;
  const m = new Uint8Array(width * height);
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(b.x));
    const y0 = Math.max(0, Math.floor(b.y));
    const x1 = Math.min(width, Math.ceil(b.x + b.w));
    const y1 = Math.min(height, Math.ceil(b.y + b.h));
    for (let y = y0; y < y1; y++) m.fill(1, y * width + x0, Math.max(y * width + x0, y * width + x1));
  }
  return m;
}

/** recolorPixels' options. */
export interface RecolorOptions {
  tolerance?: number;
  reversed?: boolean;
  flip?: boolean;
  region?: Uint8Array | null;
  /** maskCount(region), when the caller keeps it: a region only changes with its boxes. */
  regionTotal?: number;
}

/** Pixels set in a region mask. */
export function maskCount(region: Uint8Array) {
  let total = 0;
  for (let i = 0; i < region.length; i++) total += region[i];
  return total;
}

// A recolor function that keeps its last LUT (dragging the tolerance
// recolors with the same map) and, with `reuse`, writes every result into
// one buffer instead of allocating an image's worth of bytes per frame. A
// reused buffer is overwritten by the next call: callers that keep a result
// (the Recolor tab keeps it for the highlight and the peek) must want the
// latest one.
export function createRecolorer({ reuse = false }: { reuse?: boolean } = {}) {
  let last: { rgbs: Rgb[]; kind: string; reversed: boolean; lut: Uint8ClampedArray } | null = null;
  let buffer: Uint8ClampedArray<ArrayBuffer> | null = null;
  return (img: PixelImage, index: ColorIndex, map: MatchMap, opts: RecolorOptions = {}) => {
    const { tolerance = 12, reversed = false, flip = false, region = null, regionTotal } = opts;
    if (last?.rgbs !== map.rgbs || last.kind !== map.kind || last.reversed !== reversed) {
      last = { rgbs: map.rgbs, kind: map.kind, reversed, lut: mapLut(map, reversed) };
    }
    const { lut } = last;
    const src = img.data;
    let out: Uint8ClampedArray<ArrayBuffer>;
    if (reuse && buffer?.length === src.length) {
      out = buffer;
      out.set(src);
    } else {
      out = new Uint8ClampedArray(src);
      if (reuse) buffer = out;
    }
    const { t, de } = index;
    let changed = 0;
    for (let i = 0; i < t.length; i++) {
      if (!(de[i] <= tolerance) || (region && !region[i])) continue;
      let u = Math.min(1, Math.max(0, t[i]));
      if (flip) u = 1 - u;
      const k = Math.round(u * (LUT_N - 1)) * 3;
      const o = i * 4;
      out[o] = lut[k];
      out[o + 1] = lut[k + 1];
      out[o + 2] = lut[k + 2];
      out[o + 3] = 255;
      changed++;
    }
    const total = region ? (regionTotal ?? maskCount(region)) : t.length;
    return { width: img.width, height: img.height, data: out, changed, total };
  };
}

// Returns { width, height, data, changed, total } with a new RGBA byte
// array; total is the number of pixels in the region (all without one).
export function recolorPixels(img: PixelImage, index: ColorIndex, map: MatchMap, opts: RecolorOptions = {}) {
  return createRecolorer()(img, index, map, opts);
}

// Pixels within `band` of position t0 (both in bar order) and within the
// tolerance of the bar, and inside the region when there is one. With step > 1 only every step-th pixel in each
// direction is looked at, for a highlight drawn at screen size on big images.
// Returns { mask: Uint8Array of 0/1, width, height, count, total }.
export function similarMask(
  index: ColorIndex,
  t0: number,
  band: number,
  tolerance = 12,
  {
    step = 1,
    mask = null,
    region = null,
  }: { step?: number; mask?: Uint8Array | null; region?: Uint8Array | null } = {},
) {
  const { t, de } = index;
  const s = Math.max(1, Math.floor(step));
  const w = Math.ceil(index.width / s);
  const h = Math.ceil(index.height / s);
  const m = mask && mask.length === w * h ? mask : new Uint8Array(w * h);
  let count = 0;
  let total = 0;
  for (let y = 0, j = 0; y < h; y++) {
    const row = y * s * index.width;
    for (let x = 0; x < w; x++, j++) {
      const i = row + x * s;
      if (region && !region[i]) {
        m[j] = 0;
        continue;
      }
      const on = de[i] <= tolerance && Math.abs(t[i] - t0) <= band ? 1 : 0;
      m[j] = on;
      count += on;
      total++;
    }
  }
  return { mask: m, width: w, height: h, count, total };
}

// Bar position and distance of the pixel at (x, y), or null when it is not
// close to the bar or outside the region.
export function tAtPixel(index: ColorIndex, x: number, y: number, tolerance = 12, region: Uint8Array | null = null) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= index.width || yi >= index.height) return null;
  const i = yi * index.width + xi;
  if (!(index.de[i] <= tolerance) || (region && !region[i])) return null;
  return { t: index.t[i], deltaE: index.de[i] };
}

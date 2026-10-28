// Reading pixels and the color of a cell, and the dot radius in centers mode.

import type { Grid, PixelImage, Rgb } from '../../types/index.ts';
import { deltaE76, rgbToLab } from '../color.ts';
import { bilinear, cellSampleBounds, gridPixelSize, outerCorners } from './geometry.ts';

// Read one pixel as [r, g, b], compositing transparency onto white.
export function readPixel(img: PixelImage, x: number, y: number): Rgb {
  const xi = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const yi = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  const i = (yi * img.width + xi) * 4;
  const d = img.data;
  const a = d[i + 3] / 255;
  if (a >= 1) return [d[i], d[i + 1], d[i + 2]];
  return [d[i] * a + 255 * (1 - a), d[i + 1] * a + 255 * (1 - a), d[i + 2] * a + 255 * (1 - a)];
}

// Median of a typed array (sorted in place; typed-array sort is numeric).
export function median(values: Float32Array | Float64Array) {
  values.sort();
  const m = values.length >> 1;
  return values.length % 2 ? values[m] : (values[m - 1] + values[m]) / 2;
}

// Per-channel median color over the central part of a cell (a circle keeps
// only the samples inside the inscribed ellipse). Sampling density is
// roughly one sample per image pixel. Same samples as readPixel at
// bilinear(u, v), inlined: this runs for every pixel of every cell.
export function sampleCell(img: PixelImage, grid: Grid, row: number, col: number, radius: number | null = null): Rgb {
  const { u0, u1, v0, v1 } = cellSampleBounds(grid, row, col, radius);
  const c = outerCorners(grid);
  const { width, height } = gridPixelSize(c);
  const nu = Math.max(1, Math.ceil(width * (u1 - u0)));
  const nv = Math.max(1, Math.ceil(height * (v1 - v0)));
  const n = nu * nv;
  const rs = new Float64Array(n);
  const gs = new Float64Array(n);
  const bs = new Float64Array(n);
  const { width: W, height: H, data: d } = img;
  const [tl, tr, br, bl] = c;
  const circle = grid.shape === 'circle' && nu > 1 && nv > 1;
  let k = 0;
  for (let j = 0; j < nv; j++) {
    const fv = (j + 0.5) / nv;
    const v = v0 + fv * (v1 - v0);
    // Along a row of samples the bilinear map is linear in u: left + u * span.
    const lx = tl.x + v * (bl.x - tl.x);
    const ly = tl.y + v * (bl.y - tl.y);
    const sx = tr.x + v * (br.x - tr.x) - lx;
    const sy = tr.y + v * (br.y - tr.y) - ly;
    for (let i = 0; i < nu; i++) {
      const fu = (i + 0.5) / nu;
      if (circle && (2 * fu - 1) ** 2 + (2 * fv - 1) ** 2 > 1) continue;
      const u = u0 + fu * (u1 - u0);
      const xi = Math.min(W - 1, Math.max(0, Math.round(lx + u * sx)));
      const yi = Math.min(H - 1, Math.max(0, Math.round(ly + u * sy)));
      const q = (yi * W + xi) * 4;
      const a = d[q + 3] / 255;
      if (a >= 1) {
        rs[k] = d[q];
        gs[k] = d[q + 1];
        bs[k] = d[q + 2];
      } else {
        rs[k] = d[q] * a + 255 * (1 - a);
        gs[k] = d[q + 1] * a + 255 * (1 - a);
        bs[k] = d[q + 2] * a + 255 * (1 - a);
      }
      k++;
    }
  }
  return [median(rs.subarray(0, k)), median(gs.subarray(0, k)), median(bs.subarray(0, k))];
}

// ---- Dot radius (centers mode) ---------------------------------------------

const DOT_RAYS = 16;
// A cell whose center is this close (ΔE76) to the background has no dot.
const DOT_MIN_CONTRAST = 10;
const DOT_MIN_RADIUS = 1.5;

function medianColor(colors: Rgb[]) {
  return [0, 1, 2].map((ch) => median(Float64Array.from(colors, (c) => c[ch])));
}

// Radius in image pixels of the dot centered in a cell, or null when the cell
// has no dot. The background is read at the cell's corners (between dots);
// rays from the center stop where the color leaves the dot, about halfway
// between dot and background, and the radius is their median length.
export function dotRadius(img: PixelImage, grid: Grid, row: number, col: number) {
  const c = outerCorners(grid);
  const { width, height } = gridPixelSize(c);
  const center = bilinear(c, (col + 0.5) / grid.cols, (row + 0.5) / grid.rows);
  const near: Rgb[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) near.push(readPixel(img, center.x + dx, center.y + dy));
  const dot = rgbToLab(medianColor(near));
  const cornersRgb = [
    [col, row],
    [col + 1, row],
    [col + 1, row + 1],
    [col, row + 1],
  ].map(([i, j]) => {
    const p = bilinear(c, i / grid.cols, j / grid.rows);
    return readPixel(img, p.x, p.y);
  });
  const contrast = deltaE76(dot, rgbToLab(medianColor(cornersRgb)));
  if (contrast < DOT_MIN_CONTRAST) return null;
  const limit = Math.max(12, contrast / 2);
  const maxR = Math.min(width / grid.cols, height / grid.rows) / 2;
  const lengths = new Float64Array(DOT_RAYS);
  for (let i = 0; i < DOT_RAYS; i++) {
    const a = (i / DOT_RAYS) * 2 * Math.PI;
    let s = 0.5;
    while (
      s < maxR &&
      deltaE76(dot, rgbToLab(readPixel(img, center.x + s * Math.cos(a), center.y + s * Math.sin(a)))) <= limit
    )
      s += 0.5;
    lengths[i] = Math.min(s, maxR);
  }
  const r = median(lengths);
  return r >= DOT_MIN_RADIUS ? r : null;
}

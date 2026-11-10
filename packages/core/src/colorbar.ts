// Colorbar sampling: read a bar's colors along a line (t in [0, 1], start →
// end), and map arbitrary colors back to t by nearest perceptual match.
// Scales, ticks and value functions live in the apps that calibrate bars.
import { colorDistance, deltaE76, deltaE2000, labToRgb, rgbToLab } from './color.ts';
import { readPixel } from './pixels.ts';
import type { ColorbarSample, Lab, PixelImage, Point, Rgb } from './types.ts';

export const DEFAULT_SAMPLES = 256;

// Returns [{t, rgb, lab}] sampled evenly from start to end. Each sample is the
// mean over a window of ±halfWidth pixels perpendicular to the bar.
export function sampleColorbar(
  img: PixelImage,
  start: Point,
  end: Point,
  halfWidth = 2,
  n = DEFAULT_SAMPLES,
): ColorbarSample[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [];
  const px = -dy / len;
  const py = dx / len;
  const hw = Math.max(0, Math.round(halfWidth));
  const samples: ColorbarSample[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const cx = start.x + t * dx;
    const cy = start.y + t * dy;
    const sum = [0, 0, 0];
    for (let k = -hw; k <= hw; k++) {
      const [r, g, b] = readPixel(img, cx + k * px, cy + k * py);
      sum[0] += r;
      sum[1] += g;
      sum[2] += b;
    }
    const count = 2 * hw + 1;
    const rgb = sum.map((s) => s / count);
    samples.push({ t, rgb, lab: rgbToLab(rgb) });
  }
  return samples;
}

// Position of point p projected onto the line start → end, as t (unclamped).
export function projectT(start: Point, end: Point, p: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  return ((p.x - start.x) * dx + (p.y - start.y) * dy) / len2;
}

export function pointAtT(start: Point, end: Point, t: number): Point {
  return { x: start.x + t * (end.x - start.x), y: start.y + t * (end.y - start.y) };
}

// Nearest position along the sampled bar for a Lab color. Refines between the
// best sample and its closer neighbour by projecting in Lab space.
// Returns {t, deltaE}.
export function labToT(lab: Lab, samples: ColorbarSample[], distance = 'de2000'): { t: number; deltaE: number } {
  const dist = colorDistance(distance);
  let best = 0;
  let bestD = Infinity;
  // Exact pruning for CIEDE2000: its lightness term alone is at most
  // dL / 1 and at least dL / 1.75 (Sl ≤ 1.75), and the other terms never
  // make the sum smaller than that (the cross term is dominated), so a
  // sample whose dL / 1.75 already exceeds the best distance cannot win. A
  // ΔE76 seed (the likely winner) makes the bound tight from the start; ties
  // still go to the lowest index, as in a plain scan.
  const prune = dist === deltaE2000 ? 1.75 : 0;
  if (prune) {
    let seed = 0;
    let seedD = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const d = deltaE76(lab, samples[i].lab);
      if (d < seedD) {
        seedD = d;
        seed = i;
      }
    }
    best = seed;
    bestD = dist(lab, samples[seed].lab);
  }
  // ΔE76 is at least |ΔL| (no factor), which prunes the same way without a seed.
  const bound = prune || (dist === deltaE76 ? 1 : 0);
  const L = lab[0];
  for (let i = 0; i < samples.length; i++) {
    if (bound && Math.abs(L - samples[i].lab[0]) > bound * bestD) continue;
    const d = dist(lab, samples[i].lab);
    if (d < bestD || (d === bestD && i < best)) {
      bestD = d;
      best = i;
    }
  }
  let result = { t: samples[best].t, deltaE: bestD };
  for (const j of [best - 1, best + 1]) {
    if (j < 0 || j >= samples.length) continue;
    const a = samples[best].lab;
    const b = samples[j].lab;
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    if (len2 === 0) continue;
    const s = ((lab[0] - a[0]) * ab[0] + (lab[1] - a[1]) * ab[1] + (lab[2] - a[2]) * ab[2]) / len2;
    if (s <= 0 || s >= 1) continue;
    const q = [a[0] + s * ab[0], a[1] + s * ab[1], a[2] + s * ab[2]];
    const d = dist(lab, q);
    if (d < result.deltaE) {
      result = { t: samples[best].t + s * (samples[j].t - samples[best].t), deltaE: d };
    }
  }
  return result;
}

// Interpolated RGB color of the sampled bar at position t (clamped to [0, 1]).
export function colorAtT(samples: ColorbarSample[], t: number): Rgb {
  const n = samples.length;
  if (n === 0) return [0, 0, 0];
  const x = Math.min(1, Math.max(0, t)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  if (n === 1) return samples[0].rgb;
  const f = x - i;
  const a = samples[i].lab;
  const b = samples[i + 1].lab;
  return labToRgb([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])]);
}

// The Compare tab's test images (sine-section.tsx): a value pattern in
// [0, 1] painted through a colormap. Pure: no DOM.
import { lerpRgb } from '../../../core/color.ts';
import type { Rgb } from '../../../types/index.ts';

const LUT_N = 4096; // colors precomputed along the values

// Values in [0, 1] of an n × n test image, row by row (y = 0 at the top).
// 'waves': two tilted sine waves of unrelated frequencies plus rings around
// an off-center point (like the viscm-web test image), stretched to 0–1.
// The hills, dips and saddles never repeat, so every value and slope occurs
// somewhere, and edges or bands that are not in the data come from the map.
// 'bumps': a smooth ramp from 0 (top left) to 0.92 (bottom right) with a
// 6 × 6 grid of identical Gaussian bumps 0.08 high, so the same small
// difference sits at every level. A perceptually uniform map shows every bump
// equally; others hide bumps in their flat zones and exaggerate the rest.
export function sinePattern(n: number, kind = 'waves') {
  const out = new Float32Array(n * n);
  const at = (i: number) => (n > 1 ? i / (n - 1) : 0);
  if (kind === 'bumps') {
    const H = 0.08;
    const K = 6; // bumps per side
    const s2 = 2 * (0.22 / K) ** 2; // width: well apart from each other
    for (let j = 0; j < n; j++) {
      const y = at(j);
      for (let i = 0; i < n; i++) {
        const x = at(i);
        let bump = 0;
        for (let q = 0; q < K * K; q++) {
          const cx = ((q % K) + 0.5) / K;
          const cy = (Math.floor(q / K) + 0.5) / K;
          bump += Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / s2);
        }
        out[j * n + i] = Math.min(1, ((1 - H) * (x + y)) / 2 + H * bump);
      }
    }
    return out;
  }
  const TAU = 2 * Math.PI;
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < n; j++) {
    const y = at(j);
    for (let i = 0; i < n; i++) {
      const x = at(i);
      const r = Math.hypot(x - 0.62, y - 0.38);
      const v =
        0.4 * Math.sin(TAU * (1.35 * x + 0.45 * y)) +
        0.35 * Math.sin(TAU * (0.4 * x - 1.05 * y) + 1) +
        0.25 * Math.sin(TAU * 2.3 * r);
      out[j * n + i] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  for (let k = 0; k < out.length; k++) out[k] = (out[k] - lo) / (hi - lo || 1);
  return out;
}

// Colors ([r, g, b] from 0 to 255, low end first) as a LUT_N-entry byte
// array: linear between neighbors, or bands of equal width for qualitative maps.
export function colorsLut(colors: Rgb[], qualitative = false) {
  const lut = new Uint8ClampedArray(LUT_N * 3);
  const n = colors.length;
  for (let k = 0; k < LUT_N; k++) {
    const u = k / (LUT_N - 1);
    let c: Rgb;
    if (qualitative || n < 2) {
      c = colors[Math.min(n - 1, Math.floor(u * n))];
    } else {
      const x = u * (n - 1);
      const i = Math.min(n - 2, Math.floor(x));
      const f = x - i;
      c = lerpRgb(colors[i], colors[i + 1], f);
    }
    lut[k * 3] = Math.round(c[0]);
    lut[k * 3 + 1] = Math.round(c[1]);
    lut[k * 3 + 2] = Math.round(c[2]);
  }
  return lut;
}

// Values in [0, 1] → RGBA bytes through a LUT from colorsLut.
export function paintValues(
  values: ArrayLike<number>,
  lut: Uint8ClampedArray,
  out = new Uint8ClampedArray(values.length * 4),
) {
  for (let i = 0; i < values.length; i++) {
    const k = Math.round(Math.min(1, Math.max(0, values[i])) * (LUT_N - 1)) * 3;
    out[i * 4] = lut[k];
    out[i * 4 + 1] = lut[k + 1];
    out[i * 4 + 2] = lut[k + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

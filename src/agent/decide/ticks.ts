// Checking tick values against the colorbar's line and picking a scale for them.

import { isLogScale, isPiecewiseScale, piecewiseScaleFor } from '../../core/colorbar.ts';
import type { TickTV } from './types.ts';

// Ticks [{t, value}] that do not lie on one straight line along the bar
// (in log10 for a log bar): the worst one's index and its miss as a share
// of the value range, or null with fewer than 3 ticks. A misread label
// ("25" for "2.5") or a value given to the wrong box shows up here. A
// piecewise scale promises no line (a binned bar labelled 1e4, 2e4, 2e5 at
// even steps), so it is not checked. (A check of the reconstruction cannot
// see tick values: it repaints colors by position along the bar. Jev also
// judged correct reconstructions as wrong, 0.27–0.45 on example.pdf page
// 5, so it is not asked.)
export function tickMisfit(ticks: TickTV[], scale = 'linear') {
  if (ticks.length < 3 || isPiecewiseScale(scale)) return null;
  const v = ticks.map((k) => (isLogScale(scale) ? Math.log10(k.value) : k.value));
  if (v.some((x) => !Number.isFinite(x))) return null;
  const n = ticks.length;
  const mt = ticks.reduce((a, k) => a + k.t, 0) / n;
  const mv = v.reduce((a, x) => a + x, 0) / n;
  let stt = 0;
  let stv = 0;
  ticks.forEach((k, i) => {
    stt += (k.t - mt) ** 2;
    stv += (k.t - mt) * (v[i] - mv);
  });
  if (!stt) return null;
  const slope = stv / stt;
  const range = Math.max(...v) - Math.min(...v) || 1;
  let worst = { index: 0, miss: 0 };
  ticks.forEach((k, i) => {
    const miss = Math.abs(v[i] - (mv + slope * (k.t - mt))) / range;
    if (miss > worst.miss) worst = { index: i, miss };
  });
  return worst;
}

export const MISFIT = 0.03; // tick off the line by this share of the range fails the check

// The scale for a binned colorbar when the LLM gave none: linear or log10
// when the ticks lie on that line, else the piecewise scale for them
// (uneven labels at bin steps). Null keeps the panel's scale.
export function scaleForBins(ticks: TickTV[], current = 'linear') {
  if (ticks.length < 3) return null;
  const fits = (scale: string) => (tickMisfit(ticks, scale)?.miss ?? 1) <= MISFIT;
  if (fits('linear')) return current === 'linear' ? null : 'linear';
  if (ticks.every((k) => k.value > 0) && fits('log10')) return current === 'log10' ? null : 'log10';
  const s = piecewiseScaleFor(ticks);
  return s === current ? null : s;
}

// The scale for a smooth colorbar when the LLM gave none: kept when the
// ticks lie on its line; else linear or log10 when they lie on that line;
// else piecewise when the values step evenly (5, 10, 15) but sit at
// uneven places along the bar, the value per length of bar changing at
// most 2.5 times between neighbouring gaps (t6: 1.2 times). A misread
// label (6 for 5 in 0, 5, 10, 15) breaks the even steps, and the check
// still fails then. Null keeps the panel's scale.
export function scaleForTicks(ticks: TickTV[], current = 'linear') {
  if (ticks.length < 3 || isPiecewiseScale(current)) return null;
  const fits = (scale: string) => (tickMisfit(ticks, scale)?.miss ?? 1) <= MISFIT;
  if (fits(current)) return null;
  if (fits('linear')) return 'linear';
  if (ticks.every((k) => k.value > 0) && fits('log10')) return 'log10';
  const piecewise = piecewiseScaleFor(ticks);
  const v = (k: TickTV) => (isLogScale(piecewise) ? Math.log10(k.value) : k.value);
  const k = [...ticks].sort((a, b) => a.t - b.t);
  const steps = k.slice(1).map((x, i) => v(x) - v(k[i]));
  const mean = steps.reduce((a, d) => a + d, 0) / steps.length;
  if (steps.some((d) => Math.abs(d - mean) > 0.01 * Math.abs(mean))) return null;
  const slopes = k.slice(1).map((x, i) => steps[i] / (x.t - k[i].t));
  if (!slopes.every((s) => Number.isFinite(s) && s && Math.sign(s) === Math.sign(slopes[0]))) return null;
  return slopes.slice(1).every((s, i) => s / slopes[i] <= 2.5 && slopes[i] / s <= 2.5) ? piecewise : null;
}

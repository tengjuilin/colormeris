// fitCellCounts: cell counts of a placed grid from where its borders are.

import type { Corners, PixelImage } from '../../types/index.ts';
import { combAt, combCells, combFit, refineComb } from './fit-comb.ts';
import type { AxisFit, CombFit, Evidence } from './fit-evidence.ts';
import {
  axisColors,
  borderEvidence,
  COUNT_TIE,
  collapseSeparators,
  FIT_LINES,
  MIN_CELL_PX,
  MIN_FIT,
} from './fit-evidence.ts';
import { gridPixelSize } from './geometry.ts';
import { MAX_CELLS, MAX_PROFILE_SAMPLES } from './size-detect.ts';
import { suppressText } from './text.ts';

// Fit one axis: {count, score, alt, altScore, size, span: [a, b] (0–1
// along the axis, where the counted cells start and end), reason}.
function fitAxis(img: PixelImage, corners: Corners, axis: 'u' | 'v') {
  const { width, height } = gridPixelSize(corners);
  const len = axis === 'u' ? width : height;
  const N = Math.max(2, Math.min(MAX_PROFILE_SAMPLES, Math.round(len)));
  const lines = Math.min(FIT_LINES, Math.max(4, Math.round(axis === 'u' ? height : width)));
  const pxPerSample = len / N;
  const rgb = axisColors(img, corners, axis, N, lines);
  suppressText(rgb, N, lines, pxPerSample);
  const ev = borderEvidence(rgb, N, lines);
  const fit = (compress: boolean) => {
    const f = fitProfile(ev, Infinity, compress, pxPerSample);
    // A run as wide as half a cell is a column of white cells, not a gap.
    return f.wideRun ? fitProfile(ev, 0.5 * f.sizeSamples, compress, pxPerSample) : f;
  };
  let out = fit(false);
  if (out.runs) {
    const grouped = fit(true);
    // Only when clearly better: shrinking gaps also eats into noisy cells.
    if (grouped.rank > out.rank + 0.05)
      out = { ...grouped, reason: grouped.reason === 'clean' ? 'clean, groups' : grouped.reason };
  }
  const { wideRun, sizeSamples, runs, rank, ...rest } = out;
  return { ...rest, span: rest.span.map((s) => s / N) };
}

function fitProfile(ev: Evidence, maxRun: number, compress: boolean, pxPerSample: number): AxisFit {
  const N = ev.edge.length;
  const { b, orig, isSep, pale, runs } = collapseSeparators(ev, maxRun, compress);
  const M = b.length;
  const none = {
    count: 1,
    score: 0,
    rank: 0,
    alt: null,
    altScore: 0,
    size: N * pxPerSample,
    sizeSamples: N,
    span: [0, N],
    reason: 'no borders',
  };
  if (M < 2 * MIN_CELL_PX) return none;
  // Evidence within r samples, discounted with distance so that among
  // sizes whose teeth all stay in reach the one that lands on the borders
  // wins (else the drift shows only as a missed border at the far end).
  const wins = [0, 1, 2, 3].map((r) =>
    b.map((v, i) => {
      let m = v;
      for (let d = 1; d <= r; d++) m = Math.max(m, (1 - (0.5 * d) / (r + 1)) * Math.max(b[i - d] || 0, b[i + d] || 0));
      return m;
    }),
  );
  const win = wins[1];
  // Cell sizes in steps fine enough that the comb drifts under a sample
  // across the whole axis.
  const minP = Math.max(MIN_CELL_PX / pxPerSample, M / MAX_CELLS, 2);
  const step = 1 + Math.min(0.004, 1.5 / M);
  // Clear borders only: faint noise everywhere would outweigh them.
  let total = 0;
  for (let i = 1; i < M - 1; i++) total += Number(b[i] >= 0.5);
  if (total < 2) return none;
  const fits: CombFit[] = [];
  for (let P = minP; P <= M / 1.5; P *= step) fits.push(combAt(wins, b, P, total));
  if (!fits.length) return none;
  // Local maxima over the cell size, best first.
  const peaks = fits.filter(
    (f, i) => f.score >= (fits[i - 1]?.score ?? -Infinity) && f.score >= (fits[i + 1]?.score ?? -Infinity),
  );
  const top = Math.max(...peaks.map((f) => f.score));
  if (top < MIN_FIT) return { ...none, score: Math.max(0, top), reason: 'weak borders' };
  const toOrig = (t: number) => {
    const i = Math.max(0, Math.min(M - 1, t));
    const k = Math.floor(i);
    const a = orig[k];
    const c = orig[Math.min(M - 1, k + 1)];
    return a + (i - k) * (c - a);
  };
  const describe = (f: CombFit) => {
    f = refineComb(f, b);
    const c = combCells(f, wins, isSep, pale);
    const span = [toOrig(c.start), toOrig(c.end)];
    return { ...f, count: c.count, span, white: c.white, fit: combFit(f, b) };
  };
  // The most cells among the near-best sizes (smallest P), at the size
  // that fits best near it: a size 0.1% off drifts 3 px over 30 rows.
  const P0 = Math.min(...peaks.filter((f) => f.score >= top - COUNT_TIE).map((f) => f.P));
  const chosen = describe(
    peaks.filter((f) => f.P >= P0 && f.P <= 1.05 * P0).reduce((a, f) => (f.score > a.score ? f : a)),
  );
  // The best different count, for the caller to weigh.
  let alt = null;
  for (const f of peaks
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)) {
    const d = describe(f);
    if (d.count !== chosen.count) {
      alt = d;
      break;
    }
  }
  const sizeSamples = (chosen.span[1] - chosen.span[0]) / chosen.count;
  const wideRun = runs.some(([a, c]) => c - a >= 0.5 * sizeSamples);
  let reason = 'clean';
  if (chosen.fit < 0.7) reason = 'weak fit';
  if (chosen.white) {
    reason = `${reason}; ${chosen.white} white end cell${chosen.white > 1 ? 's' : ''} left out`;
    alt = { count: chosen.count + chosen.white, fit: chosen.fit };
  }
  // Every other border much weaker than the rest: half as many cells, with
  // something (a dendrogram, tick marks) across their middles.
  if (chosen.count >= 4 && chosen.count % 2 === 0) {
    const tooth = (k: number) => wins[chosen.r][Math.round(chosen.phase + k * chosen.P)] ?? 0;
    let even = 0;
    let odd = 0;
    for (let k = 0; chosen.phase + k * chosen.P < M - 1; k++) k % 2 ? (odd += tooth(k)) : (even += tooth(k));
    if (Math.min(even, odd) < 0.5 * Math.max(even, odd)) {
      reason = 'every other border weak';
      alt = { count: chosen.count / 2, fit: alt?.count === chosen.count / 2 ? alt.fit : 0 };
    }
  }
  return {
    count: chosen.count,
    score: chosen.fit,
    rank: chosen.score,
    alt: alt ? alt.count : null,
    altScore: alt ? alt.fit : 0,
    size: sizeSamples * pxPerSample,
    sizeSamples,
    span: chosen.span,
    reason,
    wideRun: wideRun && maxRun === Infinity,
    runs: runs.length,
  };
}

// Cell counts of a placed grid from where its cell borders are. Returns
// {rows, cols, rowScore, colScore} (a score near 1 is a clean fit; below
// ~0.5 the borders are not evenly spaced or not visible), plus per axis
// the best different count and its score (rowAlt, rowAltScore), the cell
// size in pixels (rowSize), where the counted cells start and end along
// the axis as 0–1 of the box (rowSpan: [a, b]; far from [0, 1] means the
// corners include something else), and a short reason (rowReason).
export function fitCellCounts(img: PixelImage, corners: Corners) {
  const cols = fitAxis(img, corners, 'u');
  const rows = fitAxis(img, corners, 'v');
  return {
    rows: rows.count,
    cols: cols.count,
    rowScore: rows.score,
    colScore: cols.score,
    rowAlt: rows.alt,
    colAlt: cols.alt,
    rowAltScore: rows.altScore,
    colAltScore: cols.altScore,
    rowSize: rows.size,
    colSize: cols.size,
    rowSpan: rows.span,
    colSpan: cols.span,
    rowReason: rows.reason,
    colReason: cols.reason,
  };
}

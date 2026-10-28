// The app's own check of a panel, and the printed-numbers cross-check.

import { isLogScale } from '../../core/colorbar.ts';
import type { CellCounts } from '../../types/index.ts';
import { MISFIT } from './ticks.ts';

// The app's own check of a panel. `counts` and `clampedShare` come from
// extractPanel (heatmap/sampling.js), `offMapReasons` counts off-map cells
// by reason, `bins` is the number of colorbar bins (0 for a smooth bar).
// Fails on a problem, ticks off the scale's line, many flagged cells
// (far from the bar's colors) or mostly off-map cells (the wrong
// colorbar). Off-map cells (gray ND cells, a black diagonal) and cells
// past the bar's ends are the figure's design: no placement fixes them.
export function checkSummary({
  problem,
  counts = null,
  clampedShare = 0,
  offMapReasons = {},
  bins = 0,
  misfit = null,
  mark = null,
}: {
  problem?: string | null;
  counts?: Partial<CellCounts> | null;
  clampedShare?: number;
  offMapReasons?: Record<string, number>;
  bins?: number;
  misfit?: { index: number; miss: number } | null;
  mark?: number | string | null;
}) {
  if (problem) return { ok: false, text: `Not ready: ${problem}` };
  const parts: string[] = [];
  const c = { cells: 0, ok: 0, flagged: 0, clamped: 0, offMap: 0, empty: 0, open: 0, ...counts };
  const filled = c.cells - c.empty;
  const badTicks = misfit && misfit.miss > MISFIT;
  if (badTicks)
    parts.push(
      `The tick values do not lie on a straight line along the bar; ${mark ? `box ${mark}` : 'one tick'} is ${Math.round(misfit!.miss * 100)}% of the range off. Check that value, or the scale (log10 for constant factors, piecewise for uneven steps).`,
    );
  const many = c.flagged > 0.2 * filled;
  const offMany = c.offMap > 0.3 * filled;
  if (filled)
    parts.push(
      `${c.flagged} of ${filled} cells are flagged as far from the colorbar's colors${many ? ' (many: the colorbar or grid may be wrong)' : ''}.`,
    );
  if (c.offMap) {
    const why = Object.entries({ gray: 'gray', hue: 'another hue', far: 'far from every bar color' })
      .filter(([k]) => offMapReasons[k])
      .map(([k, w]) => `${offMapReasons[k]} ${w}`)
      .join(', ');
    parts.push(
      offMany
        ? `${c.offMap} cells have colors that are not on this colorbar (${why}): it is likely not this heatmap's colorbar.`
        : `${c.offMap} cells have colors that are not on the colorbar (${why}), such as gray "ND" cells or a diagonal: they are left empty. Mention it in finish.`,
    );
  }
  if (bins)
    parts.push(
      `The colorbar is binned (${bins} bins): each cell gets its bin's middle value${c.open ? `; ${c.open} cells are bounds (at most or at least an outer tick's value)` : ''}.`,
    );
  if (clampedShare > 0.2)
    parts.push(
      `${Math.round(clampedShare * 100)}% of the cells are paler or darker than the colorbar's end: their values are only bounds (the end's value). If the colorbar line misses part of the strip (a pale end), fix it with use_colorbar box; otherwise mention it in finish.`,
    );
  else if (c.clamped) parts.push(`${c.clamped} cells are past an end of the colorbar and read as that end (bounds).`);
  const ok = !badTicks && !many && !offMany;
  return { ok, text: `${ok ? 'Check passed.' : 'Check failed.'} ${parts.join(' ')}` };
}

// Numbers printed in cells, read by the LLM, against the values the app
// extracted from the colors (user decision 2026-10-17: the colors stay
// the values; printed numbers are a cross-check). `pairs`: [{row, col
// (1-based), printed, value (null when the cell has none), open?}];
// `range`: {min, max} of the tick values; `scale` as on the colorbar
// (log scales compare in log10). Within 3% of the range is agreement
// (8-bit colors on a 40-unit bar and JPEG noise gave up to 1.2 units, 3%,
// on test-18). Differences that grow with the value (slope of extracted
// on printed off by more than 10%) or one offset for all point at the
// colorbar's ticks or ends, not at single cells. Returns {ok, text}.
const PRINTED_TOL = 0.03;
/** A number printed in a cell against the value extracted (1-based row and col). */
export interface PrintedPair {
  row: number;
  col: number;
  printed: number;
  value: number | null;
  open?: 'below' | 'above' | null;
}
export function printedCheck(pairs: PrintedPair[], range: { min: number; max: number }, scale = 'linear') {
  const log = isLogScale(scale);
  const f = (v: number) => (log ? Math.log10(v) : v);
  const span = Math.abs(f(range.max) - f(range.min)) || 1;
  const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
  const lines: string[] = [];
  const used: { x: number; d: number }[] = [];
  for (const p of pairs) {
    const where = `row ${p.row}, column ${p.col}`;
    if (p.value === null || !Number.isFinite(p.value)) {
      lines.push(`${where}: printed ${fmt(p.printed)}, no value extracted`);
      continue;
    }
    const d = f(p.value) - f(p.printed);
    const bound = p.open ? ` (a bound: the cell is ${p.open === 'below' ? 'below' : 'above'} the bar's end)` : '';
    lines.push(
      `${where}: printed ${fmt(p.printed)}, extracted ${fmt(p.value)}${bound}, ${Math.round((100 * Math.abs(d)) / span)}% of the range off`,
    );
    if (!p.open && Number.isFinite(f(p.printed))) used.push({ x: f(p.printed), d });
  }
  if (!used.length) return { ok: false, text: `No printed value could be compared. ${lines.join('; ')}.` };
  const off = used.filter((u) => Math.abs(u.d) > PRINTED_TOL * span);
  const parts = [`Printed vs extracted: ${lines.join('; ')}.`];
  // Systematic: one offset for all, or a slope.
  let systematic: string | null = null;
  // (Most of them off: one misread cell is not the colorbar's fault.)
  if (used.length >= 3 && off.length >= Math.max(2, 0.6 * used.length)) {
    const n = used.length;
    const mx = used.reduce((a, u) => a + u.x, 0) / n;
    const my = used.reduce((a, u) => a + u.x + u.d, 0) / n;
    let sxx = 0;
    let sxy = 0;
    for (const u of used) {
      sxx += (u.x - mx) ** 2;
      sxy += (u.x - mx) * (u.x + u.d - my);
    }
    const slope = sxx ? sxy / sxx : 1;
    const bias = used.reduce((a, u) => a + u.d, 0) / n;
    if (sxx && Math.abs(slope - 1) > 0.1)
      systematic = `the extracted values grow ${slope > 1 ? 'faster' : 'slower'} than the printed ones (slope ${Math.round(slope * 100) / 100})`;
    else if (Math.abs(bias) > PRINTED_TOL * span && used.every((u) => Math.sign(u.d) === Math.sign(bias)))
      systematic = `the extracted values are all ${bias > 0 ? 'higher' : 'lower'} by about ${fmt(Math.abs(log ? 10 ** bias : bias))}${log ? '×' : ''}`;
  }
  if (systematic)
    parts.push(
      `They disagree: ${systematic}. The colorbar's tick values, its ends or its scale are likely wrong: check set_ticks against the printed labels and the bar's ends in the image, fix them, and check again.`,
    );
  else if (off.length)
    parts.push(
      `${off.length} of ${used.length} differ by more than ${Math.round(PRINTED_TOL * 100)}% of the range: check those cells' numbers and the grid there (a misread number, or a grid line off its cell).`,
    );
  else
    parts.push(
      `They agree within ${Math.round(PRINTED_TOL * 100)}% of the range: the extraction matches the printed numbers.`,
    );
  return { ok: !systematic && !off.length, text: parts.join(' ') };
}

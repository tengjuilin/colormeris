// Choosing a panel's colorbar among the strips on the page.

import type { Box } from '../../types/index.ts';
import { besideCheck, nearCheck, sideOf } from './strip-side.ts';
import type { PlacedStrip, StripInfo } from './types.ts';

const LETTERS = 'ABCDEFGHIJ';
const MAX_CANDIDATES = 6;

// Picks a panel's colorbar among strips found on the page (`candidates`:
// [{bar, labelSide, labels (count)}], from the decision model's box and
// findColorbars). Exactly one strip beside the cells (labels on its far
// side) wins; else exactly one near them (nearCheck). With several, or
// none near, the LLM chooses: `list` holds them lettered, strips with
// tick labels first, then nearest first.
// A lone strip on the page is taken even far away (one colorbar shared by
// several blocks). `grid` ({rows, cols}, optional): a strip whose "tick
// labels" are the heatmap's own column or row labels (one per column, each
// on a column's middle: t16's dashed outline under the cells and its 13
// rotated column labels) is left out. Returns {bar, how: 'beside' |
// 'near' | 'only'} or {list: [{letter, bar, side, gap, labels}]}.
export function chooseColorbar(
  cells: Box,
  candidates: StripInfo[],
  grid: { rows: number; cols: number } | null = null,
) {
  const placed = candidates
    .map((c) => ({ ...c, at: sideOf(cells, c.bar) }))
    .filter((c) => c.at && !(grid && cellLabels(cells, c as PlacedStrip, grid))) as PlacedStrip[];
  // A strip as long as the cells, end to end, without two tick labels is
  // a group or label strip drawn along them (t9's "Group" strip above the
  // cells); it is never taken without the LLM. (A colorbar may be exactly
  // as long as the cells too, t3's, but with its numbers.)
  const alongCells = (c: PlacedStrip) => {
    const v = c.at.side === 'left' || c.at.side === 'right';
    const [a0, a1, c0, c1] = v ? [c.bar.y0, c.bar.y1, cells.y0, cells.y1] : [c.bar.x0, c.bar.x1, cells.x0, cells.x1];
    const tol = Math.max(4, 0.02 * (c1 - c0));
    return Math.abs(a0 - c0) <= tol && Math.abs(a1 - c1) <= tol;
  };
  // A strip without tick labels is not taken by itself while another one
  // has them: the decision model once boxed a row of a heatmap not
  // located yet as the colorbar.
  const numbered = (c: PlacedStrip) => (c.labels || 0) >= 2;
  const pick = (c: PlacedStrip, how: string) => (numbered(c) || !placed.some(numbered) ? { bar: c.bar, how } : null);
  const eligible = placed.filter((c) => !(alongCells(c) && !numbered(c)));
  const beside = eligible.filter((c) => besideCheck(cells, c.bar, c.at.side, c.labels ? c.labelSide : null));
  let auto: { bar: Box; how: string } | null = null;
  if (beside.length === 1) auto = pick(beside[0], 'beside');
  else if (!beside.length) {
    const near = eligible.filter((c) => nearCheck(cells, c.bar, c.at.side));
    if (near.length === 1) auto = pick(near[0], 'near');
    else if (!near.length && eligible.length === 1) auto = pick(eligible[0], 'only');
  }
  if (auto) return auto;
  // Strips with tick labels first (a colorbar has numbers), then nearest.
  const labelled = (c: PlacedStrip) => (numbered(c) ? 0 : 1);
  const list = placed
    .sort((a, b) => labelled(a) - labelled(b) || a.at.gap - b.at.gap)
    .slice(0, MAX_CANDIDATES)
    .map((c, i) => ({
      letter: LETTERS[i],
      bar: c.bar,
      side: c.at.side,
      gap: Math.round(c.at.gap),
      labels: c.labels || 0,
    }));
  return { list };
}

// Whether a strip's labels (`labelsAt`, from stripCandidate) are the
// cells' column labels (strip above or below) or row labels (left or
// right): as many as columns (rows), at least 3, each within a quarter
// cell of a column's (row's) middle.
export function cellLabels(cells: Box, c: PlacedStrip, grid: { rows: number; cols: number }) {
  const v = c.at.side === 'left' || c.at.side === 'right';
  const n = v ? grid.rows : grid.cols;
  const at = c.labelsAt || [];
  if (n < 3 || at.length !== n) return false;
  const [a0, a1] = v ? [cells.y0, cells.y1] : [cells.x0, cells.x1];
  const pitch = (a1 - a0) / n;
  return at.every((p, i) => Math.abs((v ? p.y : p.x) - (a0 + (i + 0.5) * pitch)) <= 0.25 * pitch);
}

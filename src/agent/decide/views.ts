// What the decision tools show and say: the page regions of their images
// (for the decision model and for the LLM), with their sizes and margins in
// one table, and the short texts about boxes and colorbar candidates.

import type { Box, Point } from '../../types/index.ts';
import { round } from '../round.ts';
import { growBox, union } from './geometry.ts';
import type { Side } from './types.ts';

/**
 * Sizes, margins and thresholds of the decision tools. Images for Jev have
 * no rulers and are 300–1568 px a side, as it requires.
 */
export const VIEW = {
  /** Jev's image sides: the whole page, a crop, and the least it takes. */
  jev: { pageSide: 1568, cropSide: 1024, minSide: 300 },
  /** Longest side of the LLM's images: a heatmap, a colorbar alone, the ticks after set_ticks. */
  maxSide: { panel: 900, bar: 700, ticks: 640, grid: 900 },
  /** growBox [share of the box, px] of each region. */
  grow: {
    crop: [0.25, 20], // Jev's crop around its page box
    side: [0.35, 20], // the cells and their surroundings, for the colorbar side
    bar: [0.1, 40], // a colorbar with its tick-label boxes
    ticks: [0.04, 20], // the ticks after set_ticks
    grid: [0.05, 10], // the grid after correct_grid_size
  },
  /** How far from the cells (px) labelReach looks for the white gap before the next panel. */
  reach: 300,
  /** Two panels with cells this much alike (IoU) found the same heatmap. */
  twinIou: 0.8,
  /** A tick within this t of a numbered box came from it. */
  tickMatch: 0.03,
  /** Colorbar sides Jev gives at least this probability are searched (two at most). */
  sideProbability: 0.05,
} as const;

export const CANDIDATE_COLOR = '#e8590c';

export const boxText = (b: Box) => `x ${round(b.x0, 1)}–${round(b.x1, 1)}, y ${round(b.y0, 1)}–${round(b.y1, 1)}`;
export const orientation = (bar: Box) => (bar.y1 - bar.y0 >= bar.x1 - bar.x0 ? 'vertical' : 'horizontal');

// Where a strip lies from the cells, in words: "right of and below".
export function where(cells: Box, bar: Box) {
  const h = bar.x0 >= cells.x1 - 2 ? 'right of' : bar.x1 <= cells.x0 + 2 ? 'left of' : '';
  const v = bar.y0 >= cells.y1 - 2 ? 'below' : bar.y1 <= cells.y0 + 2 ? 'above' : '';
  return [h, v].filter(Boolean).join(' and ') || 'over';
}

// Distance from the cells to a strip, for notes.
export function sideGap(cells: Box, bar: Box) {
  return Math.max(0, bar.x0 - cells.x1, cells.x0 - bar.x1, bar.y0 - cells.y1, cells.y0 - bar.y1);
}

// A box with its corners in order and inside the page.
export function clipBox(b: Box, W: number, H: number): Box {
  return {
    x0: Math.max(0, Math.min(b.x0, b.x1)),
    y0: Math.max(0, Math.min(b.y0, b.y1)),
    x1: Math.min(W, Math.max(b.x0, b.x1)),
    y1: Math.min(H, Math.max(b.y0, b.y1)),
  };
}

const grown = (b: Box, [f, px]: readonly [number, number], W: number, H: number) => growBox(b, f, px, W, H);

/** The page regions of the decision tools' images. */
export const regions = {
  // Jev's crop around its own page box.
  crop: (rough: Box, W: number, H: number) => grown(rough, VIEW.grow.crop, W, H),
  // The cells and around them, to ask which side the colorbar is on.
  side: (cells: Box, W: number, H: number) => grown(cells, VIEW.grow.side, W, H),
  // The LLM's image of a heatmap: the cells, `extra` boxes and the
  // numbered boxes, reaching to the white gap before the next panel on
  // each side (`reach(side)`, labelReach) so a neighbouring panel's
  // colorbar cannot be mistaken for this one; more room on the right for
  // the box numbers.
  panel(cells: Box, extra: Box[], reach: (side: Side) => number, W: number, H: number): Box {
    const ext = union([cells, ...extra]);
    return {
      x0: Math.max(0, Math.min(ext.x0, reach('left')) - 8),
      y0: Math.max(0, Math.min(ext.y0, reach('above')) - 8),
      x1: Math.min(W, Math.max(ext.x1, reach('right')) + 30),
      y1: Math.min(H, Math.max(ext.y1, reach('below')) + 8),
    };
  },
  // A colorbar with its numbered tick-label boxes, on its own.
  bar: (bar: Box, labels: Box[], W: number, H: number) => grown(union([bar, ...labels]), VIEW.grow.bar, W, H),
  // After set_ticks: the grid and the colorbar line (6 px around it) with
  // the tick-label boxes; only the bar and its labels when it lies further
  // from the cells than half their longer side.
  ticks(cells: Box, start: Point, end: Point, labels: Box[], W: number, H: number) {
    const bar = {
      x0: Math.min(start.x, end.x) - 6,
      y0: Math.min(start.y, end.y) - 6,
      x1: Math.max(start.x, end.x) + 6,
      y1: Math.max(start.y, end.y) + 6,
    };
    const apart = sideGap(cells, bar) > 0.5 * Math.max(cells.x1 - cells.x0, cells.y1 - cells.y0);
    return { region: grown(union(apart ? [bar, ...labels] : [cells, bar, ...labels]), VIEW.grow.ticks, W, H), apart };
  },
  // The grid after correct_grid_size.
  grid: (cells: Box, W: number, H: number) => grown(cells, VIEW.grow.grid, W, H),
};

// The colorbar sides worth a look from Jev's side answer: up to two with
// some probability, likeliest first ('none' left out).
export function likelySides(side: { choice?: string; probabilities?: Record<string, number> }) {
  return Object.entries(side.probabilities || { [side.choice!]: 1 })
    .filter(([k, pr]) => k !== 'none' && pr >= VIEW.sideProbability)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
    .slice(0, 2);
}

// One line per lettered colorbar candidate, for the locate note.
export function candidateLines(
  cells: Box,
  list: { letter: string; bar: Box; gap: number; labels: number }[],
): string[] {
  return list.map(
    (c) =>
      `${c.letter}: ${orientation(c.bar)}, ${where(cells, c.bar)} the cells, ${c.gap} px away, ${boxText(c.bar)}, ${c.labels} tick label${c.labels === 1 ? '' : 's'}`,
  );
}

// labelReach: how far the labels next to a block of cells reach.

import type { Box, PixelImage } from '../../types/index.ts';
import { readPixel } from '../grid.ts';
import { background, clamp, differs, INK } from './helpers.ts';

// How far the labels next to a block of cells reach on one side ('left',
// 'right', 'above', 'below'): walk away from the block until `gap` blank
// lines in a row (within the block's span), at most `reach` pixels. Used
// to crop a heatmap with its labels but without the next figure panel.
// The gap grows with the block (2% of its size, at least 15 px): on a
// 1770 px wide screenshot the row labels sat 24 px left of their legend
// boxes and were cut off.
export function labelReach(img: PixelImage, cells: Box, side: string, reach: number, gap: number | null = null) {
  const horizontal = side === 'left' || side === 'right';
  gap ??= Math.max(15, Math.round(0.02 * (horizontal ? cells.x1 - cells.x0 : cells.y1 - cells.y0)));
  const dir = side === 'left' || side === 'above' ? -1 : 1;
  const start =
    side === 'left' ? cells.x0 - 1 : side === 'right' ? cells.x1 : side === 'above' ? cells.y0 - 1 : cells.y1;
  const [s0, s1] = horizontal ? [cells.y0, cells.y1] : [cells.x0, cells.x1];
  const end = horizontal ? img.width : img.height;
  // Background from the strip walked over, not the cells.
  const [a0, a1] = dir < 0 ? [start - reach, start] : [start, start + reach];
  const bx0 = clamp(Math.round(horizontal ? a0 : s0), 0, img.width - 1);
  const by0 = clamp(Math.round(horizontal ? s0 : a0), 0, img.height - 1);
  const bx1 = clamp(Math.round(horizontal ? a1 : s1), bx0 + 1, img.width);
  const by1 = clamp(Math.round(horizontal ? s1 : a1), by0 + 1, img.height);
  const ink = differs(background(img, bx0, by0, bx1, by1), INK);
  const step = Math.max(1, Math.floor((s1 - s0) / 150));
  const blank = (a: number) => {
    for (let b = Math.round(s0); b < s1; b += step)
      if (ink(horizontal ? readPixel(img, a, b) : readPixel(img, b, a))) return false;
    return true;
  };
  let last = start;
  let empty = 0;
  for (let i = 1, a = start + dir; i <= reach && a >= 0 && a < end; i++, a += dir) {
    if (blank(a)) {
      if (++empty >= gap) break;
    } else {
      empty = 0;
      last = a;
    }
  }
  return last;
}

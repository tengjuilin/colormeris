// Which side of the cells a colorbar strip is on, and whether page ink flanks it.

import type { Box, PixelImage } from '../../types/index.ts';
import type { Side } from './types.ts';

// Whether a strip found on `side` of the cells can be their colorbar:
// close to them (a neighbour's colorbar is further away), running along
// them for at least half its length, a strip rather than a line, and with its tick labels (`labelSide`
// from findTickLabels, if any) on its far side: a colorbar's labels face
// away from its own heatmap. On example.pdf page 3, panel h's colorbar sits
// 72 px left of panel i with its labels towards i. `reach` (a share of the
// cells' size across the gap) is 0.25 here; nearCheck allows more.
export function besideCheck(
  cells: Box,
  bar: Box,
  side: string,
  labelSide: string | null = null,
  reach: number | null = null,
) {
  if (labelSide && labelSide !== side) return false;
  const vertical = side === 'left' || side === 'right';
  const gap =
    side === 'right'
      ? bar.x0 - cells.x1
      : side === 'left'
        ? cells.x0 - bar.x1
        : side === 'below'
          ? bar.y0 - cells.y1
          : cells.y0 - bar.y1;
  reach ??= Math.max(40, 0.25 * (vertical ? cells.x1 - cells.x0 : cells.y1 - cells.y0));
  const [a0, a1, c0, c1] = vertical ? [bar.y0, bar.y1, cells.y0, cells.y1] : [bar.x0, bar.x1, cells.x0, cells.x1];
  const overlap = Math.min(a1, c1) - Math.max(a0, c0);
  // A strip at least 4 px thick and 15% as long as the cells (not a line or
  // speck; a 32-column heatmap had a colorbar 24% as long as its width).
  const thick = vertical ? bar.x1 - bar.x0 : bar.y1 - bar.y0;
  return gap >= -2 && gap <= reach && overlap >= 0.5 * (a1 - a0) && thick >= 4 && a1 - a0 >= 0.15 * (c1 - c0);
}

// A colorbar further out but still the cells' own: up to 60% of their
// longer side away, labels on either side. A narrow tall heatmap had its
// colorbar 140 px to the right (0.8 of its width); another had its tick
// labels facing the cells.
export function nearCheck(cells: Box, bar: Box, side: string) {
  return besideCheck(cells, bar, side, null, Math.max(80, 0.6 * Math.max(cells.x1 - cells.x0, cells.y1 - cells.y0)));
}

// Which side of the cells a strip lies on, and how far: the axis with the
// larger gap wins for a strip off a corner. Null when they overlap.
export function sideOf(cells: Box, bar: Box): { side: Side; gap: number } | null {
  const dx: [Side, number] | null =
    bar.x0 >= cells.x1 - 2 ? ['right', bar.x0 - cells.x1] : bar.x1 <= cells.x0 + 2 ? ['left', cells.x0 - bar.x1] : null;
  const dy: [Side, number] | null =
    bar.y0 >= cells.y1 - 2
      ? ['below', bar.y0 - cells.y1]
      : bar.y1 <= cells.y0 + 2
        ? ['above', cells.y0 - bar.y1]
        : null;
  const [side, gap] = !dx ? dy || [null, -1] : !dy ? dx : dx[1] >= dy[1] ? dx : dy;
  return side ? { side, gap } : null;
}

// Share of ink (off the page color) in the bands 4–10 px outside each
// long side of a strip (or, `across`, past each end), the larger of the
// two; pixels in `exclude` boxes (known heatmap cells) are skipped. A
// colorbar stands on the page, with at most a frame line, tick marks and
// labels beside it and nothing past its ends; a run of cells inside a
// heatmap not located yet has more cells past its ends. The page color is
// the median of the page's edge pixels.
export function flankInk(img: PixelImage, bar: Box, exclude: Box[] = [], across = false) {
  const px = (x: number, y: number): number[] => {
    const i = (Math.round(y) * img.width + Math.round(x)) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  };
  const edge: number[][] = [];
  const step = Math.max(1, Math.floor((img.width + img.height) / 400));
  for (let x = 0; x < img.width; x += step) edge.push(px(x, 0), px(x, img.height - 1));
  for (let y = 0; y < img.height; y += step) edge.push(px(0, y), px(img.width - 1, y));
  const med = [0, 1, 2].map((c) => edge.map((p) => p[c]).sort((a, b) => a - b)[edge.length >> 1]);
  const skip = (x: number, y: number) => exclude.some((b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1);
  // `across`: the bands beyond the strip's two ends instead of its sides.
  const vertical = bar.y1 - bar.y0 >= bar.x1 - bar.x0 !== across;
  const [a0, a1] = vertical ? [bar.y0, bar.y1] : [bar.x0, bar.x1];
  const ends = vertical ? [bar.x0, bar.x1] : [bar.y0, bar.y1];
  const lim = vertical ? img.width : img.height;
  let worst = 0;
  for (const [from, dir] of [
    [ends[0], -1],
    [ends[1] - 1, 1],
  ] as [number, number][]) {
    let ink = 0;
    let n = 0;
    for (let d = 4; d <= 10; d += 2) {
      const b = from + dir * d;
      if (b < 0 || b >= lim) continue;
      for (let a = a0; a < a1; a += Math.max(1, (a1 - a0) / 60)) {
        const [x, y] = vertical ? [b, a] : [a, b];
        if (skip(x, y)) continue;
        n++;
        if (Math.max(...px(x, y).map((v, c) => Math.abs(v - med[c]))) > 40) ink++;
      }
    }
    if (n) worst = Math.max(worst, ink / n);
  }
  return worst;
}

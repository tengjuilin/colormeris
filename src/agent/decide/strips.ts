// Colorbar candidates found from the pixels, and the text about their tick-label boxes.

import { findColorbars, findTickLabels } from '../../core/locate.ts';
import type { Box, PixelImage } from '../../types/index.ts';
import { overlaps } from './cells.ts';
import { flankInk } from './strip-side.ts';
import type { StripInfo } from './types.ts';

// A colorbar candidate {bar, labelSide, labels} for a strip, or null.
// A strip needs the page past its ends and beside it: a run of cells in a
// heatmap not located yet looks like a binned bar (test-1's average rows,
// test-10's main heatmap seen from the strip above it), with more cells
// past its ends (ink 0.95–1 there, 0–0.11 past a real colorbar's ends on
// 14 figures). A strip from the pixels alone (`minLabels` 2) also needs
// two tick labels; one the decision model boxed may have none found.
export function stripCandidate(
  img: PixelImage,
  bar: Box | null | undefined,
  exclude: Box[] = [],
  groups: Box[] = [],
  minLabels = 0,
): StripInfo | null {
  if (!bar || exclude.some((c) => overlaps(c, bar)) || groups.some((g) => overlaps(g, bar))) return null;
  const labels = findTickLabels(img, bar, { exclude });
  if (labels.marks.length < minLabels || flankInk(img, bar, exclude, true) > 0.5 || flankInk(img, bar, exclude) > 0.85)
    return null;
  return {
    bar: { x0: bar.x0, y0: bar.y0, x1: bar.x1, y1: bar.y1 },
    labelSide: labels.side,
    labels: labels.marks.length,
    labelsAt: labels.marks.map((m) => m.at),
  };
}

// Colorbar candidates on the page from the pixels alone (findColorbars,
// with the known heatmap cells in `exclude`), and the categorical group
// strips, which stay out even when the decision model boxes one.
export function pageColorbars(img: PixelImage, exclude: Box[] = []) {
  const found = findColorbars(img, { exclude });
  const groups = found.filter((b) => b.kind === 'categorical');
  const candidates: StripInfo[] = [];
  for (const bar of found) {
    if (bar.kind === 'categorical' || candidates.some((c) => overlaps(c.bar, bar))) continue;
    const c = stripCandidate(img, bar, exclude, [], 2);
    if (c) candidates.push(c);
  }
  return { candidates, groups };
}

// What the LLM is told about a colorbar's numbered tick-label boxes
// (findTickLabels marks, with `note` on odd ones): how many there are, so
// it never gives a box number that does not exist (t10: 5 ticks read off 4
// boxes), which ones look odd, and whether the strip was extended to a
// label past its pale end.
export function tickBoxesText(marks: { note?: string }[], { extended = false }: { extended?: boolean } = {}) {
  if (!marks.length) return 'No tick labels were found beside it: give ticks to set_ticks as {t, value}.';
  const n = marks.length;
  const odd = marks.map((m, i) => (m.note ? `box ${i + 1} is ${m.note}` : null)).filter(Boolean);
  return [
    `${n} tick-label box${n === 1 ? '' : 'es'} found, numbered ${n === 1 ? '1' : `1–${n}`} in reading order; there are no others. A printed tick label without a box goes to set_ticks as {t, value}.`,
    odd.length ? `Check: ${odd.join('; ')}.` : '',
    extended
      ? 'The strip fades into the page at one end; the colorbar line was extended to the tick label just past it.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

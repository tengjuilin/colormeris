// Pure pieces of the agent actions in api.ts: the notes set_colorbar and
// add_tick return to the LLM, and sample_pixel's averaged color. The note
// texts are tuned against real runs; keep them as they are.

import { readPixel } from '../core/grid.ts';
import type { PixelImage, Point, Rgb } from '../types/index.ts';
import { round } from './round.ts';

/** What set_colorbar's snap reports (refineColorbar's answer, as far as the note reads it). */
interface ColorbarFit {
  stripHalf: number;
  found: { start: boolean; end: boolean };
}

// set_colorbar's note: placed as given, not snapped (no strip), or how
// far each end moved and which ends found no edge.
export function colorbarNote({
  snap,
  fit,
  given,
  placed,
  halfWidth,
}: {
  snap: boolean;
  fit: ColorbarFit | null;
  given: { start: Point; end: Point };
  placed: { start: Point; end: Point };
  halfWidth: number | undefined;
}) {
  if (!snap) return 'Placed as given (no snapping).';
  if (!fit)
    return 'No colored strip was found under the line, so it was placed as given. Check that the line runs along the bar.';
  const pt = (q: Point) => `(${round(q.x, 1)}, ${round(q.y, 1)})`;
  let note = `Snapped to the strip (${Math.round(fit.stripHalf * 2 + 1)} px wide): start ${pt(given.start)} → ${pt(placed.start)}, end ${pt(given.end)} → ${pt(placed.end)}, halfWidth ${halfWidth}.`;
  const missed = (['start', 'end'] as const).filter((k) => !fit.found[k]);
  if (missed.length)
    note += ` No clear edge was found near the ${missed.join(' and ')}; ${missed.length > 1 ? 'they were' : 'it was'} only moved sideways. Check ${missed.length > 1 ? 'them' : 'it'} on a zoomed view.`;
  return note;
}

// add_tick's note: how far the snap moved the tick, if at all.
export function tickNote(snap: boolean, mark: { moved: number } | null) {
  if (!snap) return 'Placed as given.';
  return mark
    ? `Snapped ${Math.abs(mark.moved)} px along the bar onto the tick mark.`
    : 'No tick mark found nearby; placed as given.';
}

// The mean color of the (2r+1)² square around (x, y), rounded to integers.
export function averagePixel(img: PixelImage, x: number, y: number, radius = 0): Rgb {
  const acc = [0, 0, 0];
  let n = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = readPixel(img, x + dx, y + dy);
      for (let i = 0; i < 3; i++) acc[i] += px[i];
      n++;
    }
  }
  return acc.map((v) => Math.round(v / n)) as Rgb;
}

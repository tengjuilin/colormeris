import { matchLevel } from '../../../core/colormap-match.ts';
import { pct } from '../../common.ts';

// The pure parts of the Recolor tab: constants and texts, how the old colormap
// is named, the hover readout, the highlight overlay's pixels, and what a key
// does on a strip. No DOM and no React, so they are unit tested.

export const DEFAULT_MAP = 'viridis';
export const TOLERANCE = 12; // ΔE76: JPEG noise stays inside, white and gray outside
export const BAND = 2; // percent of the bar that counts as "similar" on hover
export const CHUNK = 300000; // pixels indexed between pauses
export const OVERLAY_MAX = 1600; // the highlight is drawn at about screen size, not image size

export const EMPTY_HINT =
  'Drop an image here, paste one (Ctrl/Cmd+V), or click to choose a file (PNG, JPEG, WebP or GIF).';
export const LOADED_HINT =
  'Drag along the colorbar from one end to the other. The figure is then redrawn in the new colormap next to the original. Hover a color in either to see where it appears; press and hold one to see the other version in its place.';
export const DRAWING_HINT =
  'Drag rectangles on the original around the parts to recolor. Press Draw regions again (or Esc) when done.';

/** "3 regions", or "Whole image" with none. */
export const regionText = (n: number) => (n ? `${n} region${n > 1 ? 's' : ''}` : 'Whole image');

/** What the status line says about the old colormap (identifyColorbar's best match). */
export interface OldNote {
  level: 'exact' | 'close' | 'none';
  name: string;
  /** ΔE of the best match, or null when there was none. */
  score: number | null;
  /** The line runs from the old map's high end, so the bar is read the other way. */
  flip: boolean;
  /** The line was snapped onto a colorbar. */
  snapped: boolean;
}

export function describeOldMap(
  best: { name: string; score: number; reversed: boolean } | undefined,
  snapped: boolean,
): OldNote {
  const level = best ? matchLevel(best.score) : 'none';
  return {
    level,
    name: best?.name ?? '',
    score: best ? best.score : null,
    flip: level !== 'none' && !!best?.reversed,
    snapped,
  };
}

/** The same sentence the tab always said, as text pieces: `code` is the map's name, set in <code>. */
export function oldNoteParts(n: OldNote): { before: string; code: string; after: string } {
  const de = n.score != null ? n.score.toFixed(1) : '–';
  let before: string;
  let code = '';
  let after: string;
  if (n.level === 'none') {
    before = `The old colors match no known colormap (best ΔE ${de}), so the end where you started the line is taken as the low end.`;
    after = '';
  } else {
    before = n.level === 'exact' ? 'Old colormap: ' : 'Old colormap looks like ';
    code = n.name;
    after = ` (ΔE ${de}).${n.flip ? ' The line runs from its high end, so it is read the other way.' : ''}`;
  }
  if (!n.snapped) after += ' The line could not be snapped to a colorbar; drag along the middle of the bar.';
  return { before, code, after };
}

/** The readout under the images. */
export interface Readout {
  text: string;
  /** Swatch color while hovering. */
  hex: string | null;
  /** Position on the bar (0-1) while hovering, else null. */
  t: number | null;
  /** The last position as a percent, for the strips' aria-valuenow. */
  now: number | null;
}

export const EMPTY_READOUT: Readout = { text: '', hex: null, t: null, now: null };

export function idleReadout(changed: number, total: number, inRegions: boolean): string {
  const where = inRegions ? 'of the pixels in the regions' : 'of the pixels';
  return `${pct(changed / (total || 1))} ${where} have a color of the bar and are recolored. Hover a color to see where it is.`;
}

export function hoverReadout(t: number, count: number, total: number, inRegions: boolean, band: number): string {
  return ` At ${pct(t)} of the bar: ${pct(count / (total || 1))} of the pixels${inRegions ? ' in the regions' : ''} (±${pct(band)}).`;
}

/** The position a key moves a strip's highlight to, or null for a key that does nothing. */
export function keyTarget(key: string, now: number, shift: boolean): number | null {
  const step = shift ? 0.1 : 0.01;
  const next: Record<string, number> = {
    ArrowLeft: now - step,
    ArrowDown: now - step,
    ArrowRight: now + step,
    ArrowUp: now + step,
    Home: 0,
    End: 1,
  };
  return next[key] ?? null;
}

/** Name of the downloaded PNG: the figure's, then the new map (with _r when reversed). */
export const downloadName = (figName: string, chosen: string, reversed: boolean) =>
  `${figName}-${chosen}${reversed ? '_r' : ''}.png`;

// Little-endian RGBA as one word.
const VEIL = (180 << 24) | (255 << 16) | (255 << 8) | 255; // white veil over the rest

/**
 * Fills the highlight overlay: `px` is its pixels as words, `mask` marks the
 * similar ones. Calm: the rest is veiled in white. Otherwise each similar
 * pixel flashes to the complement (255 − r, 255 − g, 255 − b) of the color
 * shown under it, which stands out whatever the map. `shown` is the RGBA of
 * the image under the overlay, `step` the overlay's pixel size in image pixels.
 */
export function fillOverlay(
  px: Uint32Array,
  mask: Uint8Array,
  calm: boolean,
  shown: ArrayLike<number>,
  step: number,
  width: number,
  imageWidth: number,
) {
  const n = mask.length;
  if (calm) {
    for (let j = 0; j < n; j++) px[j] = mask[j] ? 0 : VEIL;
    return;
  }
  for (let j = 0; j < n; j++) {
    if (!mask[j]) {
      px[j] = 0;
      continue;
    }
    const o = (((j / width) | 0) * step * imageWidth + (j % width) * step) * 4;
    px[j] = (255 << 24) | ((255 - shown[o + 2]) << 16) | ((255 - shown[o + 1]) << 8) | (255 - shown[o]);
  }
}

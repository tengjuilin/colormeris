// Map tool, reading colors (pure): the flag bits a value can carry, and the colorbar's samples with a cached
// color → value reader, shared by the field (extract.ts) and the profiles (profiles.ts).
import { colorDistance, rgbToLab } from '../../../core/color.ts';
import { colorbarSamples, labToT, makeValueFn } from '../../../core/colorbar.ts';
import type { ColorbarSample, Panel, PanelSettings, PixelImage, Rgb } from '../../../types/index.ts';
import { ticksWithT } from '../../project/project.ts';

// Flags per value.
export const FLAG_DELTA_E = 1;
export const FLAG_LOW = 2;
export const FLAG_HIGH = 4;

/** How a color reads (makeColorReader); clip is FLAG_LOW or FLAG_HIGH when it is at an end of the bar, else 0. */
export interface ColorHit {
  t: number;
  value: number;
  deltaE: number;
  clip: number;
}

// A color counts as at an end of the colorbar (possibly clipped) when it is
// about as close to the end color as to its best match. A t threshold would
// miss it: the end pixel of a bar covers several equal samples, and the match
// lands on the first of them.
const CLIP_DELTA_E = 0.5;

// rgb → {t, value, deltaE, clip}, cached per color: maps repeat colors
// heavily, and the colorbar search is the expensive part.
function makeColorReader(samples: ColorbarSample[], valueAt: (t: number) => number, settings: PanelSettings) {
  const cache = new Map<number, ColorHit>();
  const dist = colorDistance(settings.distance);
  const low = samples[0].lab;
  const high = samples[samples.length - 1].lab;
  return (rgb: Rgb): ColorHit => {
    const r = Math.round(rgb[0]);
    const g = Math.round(rgb[1]);
    const b = Math.round(rgb[2]);
    const key = (r << 16) | (g << 8) | b;
    let hit = cache.get(key);
    if (!hit) {
      const lab = rgbToLab([r, g, b]);
      const { t, deltaE } = labToT(lab, samples, settings.distance);
      const clip =
        dist(lab, low) <= deltaE + CLIP_DELTA_E ? FLAG_LOW : dist(lab, high) <= deltaE + CLIP_DELTA_E ? FLAG_HIGH : 0;
      hit = { t, value: valueAt(t), deltaE, clip };
      cache.set(key, hit);
    }
    return hit;
  };
}

// The colorbar's samples and color reader depend only on the image, the
// colorbar and the distance. Profiles are read again on every drag or sweep
// frame, so the last few are kept: each keeps its color cache warm, and
// rebuilding the 256 samples per profile would cost more than reading it.
const PREPARED_KEEP = 4;
export interface PreparedColorbar {
  samples: ColorbarSample[];
  read: (rgb: Rgb) => ColorHit;
}
const preparedCache: { img: PixelImage; key: string; value: PreparedColorbar }[] = [];

/** The panel's colorbar samples and color reader for img (the colorbar must be usable: colorbarProblem passed). */
export function prepareColorbar(img: PixelImage, panel: Panel): PreparedColorbar {
  const cb = panel.colorbar;
  const key = JSON.stringify([cb, panel.settings.distance]);
  const at = preparedCache.findIndex((e) => e.img === img && e.key === key);
  if (at >= 0) {
    const [hit] = preparedCache.splice(at, 1);
    preparedCache.unshift(hit);
    return hit.value;
  }
  const samples = colorbarSamples(img, cb);
  const valueAt = makeValueFn(ticksWithT(cb), cb.scale);
  const value = { samples, read: makeColorReader(samples, valueAt!, panel.settings) };
  preparedCache.unshift({ img, key, value });
  preparedCache.length = Math.min(preparedCache.length, PREPARED_KEEP);
  return value;
}

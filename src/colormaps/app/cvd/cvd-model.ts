import { deltaE2000, rgbToHex, rgbToLab } from '../../../core/color.ts';
import { type CvdPixelOptions, cvdLinearFn, resolveCvdModel, simulateCvdPixels } from '../../../core/cvd.ts';
import type { PixelImage, Rgb } from '../../../types/index.ts';

// The pure part of the CVD tab: the kinds of deficiency, the captions, the
// chunked simulation with its cache, and the hover readout.

/** key, button, full name, partial name, what is missing (tooltip) */
export type CvdKind = readonly [key: string, button: string, full: string, partial: string, tip: string];

export const TYPES: readonly CvdKind[] = [
  ['protanopia', 'Protan', 'Protanopia', 'Protanomaly', 'Missing or shifted L (red) cones'],
  [
    'deuteranopia',
    'Deutan',
    'Deuteranopia',
    'Deuteranomaly',
    'Missing or shifted M (green) cones; the most common kind',
  ],
  ['tritanopia', 'Tritan', 'Tritanopia', 'Tritanomaly', 'Missing or shifted S (blue) cones; rare'],
  [
    'achromatopsia',
    'Gray',
    'Achromatopsia',
    'Achromatomaly',
    'Achromatopsia: no color vision at all. Shown as the gray of the same luminance (CIELAB L*), as in Browse; very rare',
  ],
];
export const TYPE = new Map(TYPES.map((t) => [t[0], t]));
export const MODEL_NAMES: Record<string, string> = {
  brettel: 'Brettel 1997',
  vienot: 'Viénot 1999',
  machado: 'Machado 2009',
  luminance: 'grayscale by luminance',
};
export const DEFAULT_TYPE = 'deuteranopia';
export const CHUNK = 400000; // pixels simulated between pauses
export const KEEP = 6; // simulated images kept, so going back to a setting is instant
export const EXAMPLE_NAME = 'example-jet.png';

/** The simulations shown for the selected button ('all' shows all four). */
export const shownTypes = (type: string): string[] => (type === 'all' ? TYPES.map((t) => t[0]) : [type]);

/** The caption of a simulation panel. */
export function caption(k: string, severity: number, model: string): string {
  const [, label, full, partial] = TYPE.get(k)!;
  const used = resolveCvdModel(k, model);
  const m = MODEL_NAMES[used] + (k === 'tritanopia' && model === 'vienot' ? '; Viénot 1999 has no tritan model' : '');
  if (severity === 0) return `${label}, severity 0: normal vision`;
  return severity >= 1 ? `${full} (${m})` : `${partial}, severity ${severity.toFixed(1)} (${m})`;
}

/** Keeps the last KEEP simulated images, most recent last. */
export type SimCache = Map<string, ImageData>;

export interface SimulateArgs {
  src: PixelImage;
  kind: string;
  model: string;
  severity: number;
  cache: SimCache;
  /** Polled between chunks; true drops the run (a newer one started). */
  cancelled: () => boolean;
  onProgress?: (percent: number) => void;
  /** Where the result goes; ImageData in the browser. */
  makeImage?: (w: number, h: number) => ImageData;
  pause?: () => Promise<void>;
}

const defaultPause = () => new Promise<void>((r) => setTimeout(r, 0));

/** Simulates a deficiency over an image in chunks (so the page stays responsive); null when cancelled. */
export async function simulateImage(a: SimulateArgs): Promise<ImageData | null> {
  const { src, kind, model, severity, cache } = a;
  const key = `${kind}|${resolveCvdModel(kind, model)}|${severity}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // most recent last
    return hit;
  }
  const out = (a.makeImage ?? ((w, h) => new ImageData(w, h)))(src.width, src.height);
  const opts: CvdPixelOptions = { model, severity, out: out.data, cache: new Map() };
  opts.fn = cvdLinearFn(kind, opts);
  const n = src.width * src.height;
  for (let from = 0; from < n; from += CHUNK) {
    simulateCvdPixels(src.data, kind, { ...opts, from, to: Math.min(n, from + CHUNK) });
    if (n > CHUNK) {
      a.onProgress?.(Math.round((100 * Math.min(n, from + CHUNK)) / n));
      await (a.pause ?? defaultPause)();
      if (a.cancelled()) return null;
    }
  }
  cache.set(key, out);
  while (cache.size > KEEP) cache.delete(cache.keys().next().value as string);
  return out;
}

export function pixelAt(img: PixelImage, x: number, y: number): Rgb {
  const o = (y * img.width + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
}

export interface ReadoutItem {
  key: string;
  label: string;
  hex: string;
  de: number;
}

/** The colors at an image pixel: the original, and each shown simulation with its ΔE2000 from the original. */
export function readoutAt(
  orig: PixelImage,
  sims: { key: string; data?: PixelImage | null }[],
  x: number,
  y: number,
): { origHex: string; items: ReadoutItem[] } {
  const o = pixelAt(orig, x, y);
  const lab = rgbToLab(o);
  const items: ReadoutItem[] = [];
  for (const p of sims) {
    if (!p.data) continue;
    const s = pixelAt(p.data, x, y);
    items.push({ key: p.key, label: TYPE.get(p.key)![1], hex: rgbToHex(s), de: deltaE2000(lab, rgbToLab(s)) });
  }
  return { origHex: rgbToHex(o), items };
}

/** The pixel of an image under a pointer, or null outside it. */
export function imagePixelAt(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number },
  box: { clientLeft: number; clientTop: number; clientWidth: number; clientHeight: number },
  img: PixelImage,
): { x: number; y: number } | null {
  const w = box.clientWidth || 1;
  const h = box.clientHeight || 1;
  const x = Math.floor(((clientX - rect.left - box.clientLeft) / w) * img.width);
  const y = Math.floor(((clientY - rect.top - box.clientTop) / h) * img.height);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null;
  return { x, y };
}

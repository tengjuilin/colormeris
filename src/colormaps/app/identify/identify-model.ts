import { cmapData } from '../../../core/colormap-library.ts';
import { matchLevel } from '../../../core/colormap-match.ts';
import { readPixel } from '../../../core/grid.ts';
import type { PixelImage, Rgb } from '../../../types/index.ts';
import { base } from '../../library-cache.ts';

// The pure part of the Identify tab: the maps to match against, the grouping
// of equal matches, the verdict, and the pixels of a whole-image run.

export const ID_MAX_PIXELS = 40000; // whole-image mode looks at about this many pixels
export const ID_TIE = 0.01; // maps whose scores differ by less than this have the same colors

/** One ranked map, from identifyColorbar (reversed) or identifyColors (coverage). */
export interface Scored {
  name: string;
  score: number;
  reversed?: boolean;
  coverage?: number;
}

export interface MatchGroup {
  lead: Scored;
  ties: Scored[];
}

export interface IdentifyMap {
  name: string;
  kind: string;
  rgbs: Rgb[];
}

// Built on the first match and kept: the matcher caches each map's Lab by its
// color list, so the next figure reuses them.
let idMaps: IdentifyMap[] | null = null;
export function identifyMaps(): IdentifyMap[] {
  idMaps ??= cmapData.maps.map((m) => ({ name: m.name, kind: m.kind, rgbs: base(m) }));
  return idMaps;
}

/**
 * Matches within ID_TIE of the best remaining one are the same colors (gray,
 * gist_gray, binary reversed), so they share one entry.
 */
export function groupTies(list: readonly Scored[], max = 5): MatchGroup[] {
  const groups: MatchGroup[] = [];
  for (const r of list) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(r.score - g.lead.score) < ID_TIE) g.ties.push(r);
    else if (groups.length < max) groups.push({ lead: r, ties: [] });
    else break;
  }
  return groups;
}

/** 'exact' | 'close' | 'none' (matchLevel) */
export type MatchLevel = string;

/** What the verdict line says, and the groups under it; null for no match at all. */
export function describeMatches(results: readonly Scored[]) {
  if (!results.length) return null;
  const groups = groupTies(results);
  const best = groups[0].lead;
  return { groups, best, level: matchLevel(best.score) };
}

/** Pixels of the whole image, thinned to about ID_MAX_PIXELS. */
export function wholeImagePixels(img: PixelImage): Rgb[] {
  const step = Math.max(1, Math.ceil(Math.sqrt((img.width * img.height) / ID_MAX_PIXELS)));
  const px: Rgb[] = [];
  for (let y = 0; y < img.height; y += step) for (let x = 0; x < img.width; x += step) px.push(readPixel(img, x, y));
  return px;
}

const reversedOf = new Map<string, Rgb[]>();
/** The map's colors, or in reverse order (cached, so the strips' memo holds). */
export function miniColors(name: string, reversed: boolean): Rgb[] {
  const map = cmapData.maps.find((m) => m.name === name);
  if (!map) return [];
  if (!reversed) return base(map);
  let r = reversedOf.get(name);
  if (!r) reversedOf.set(name, (r = base(map).slice().reverse()));
  return r;
}

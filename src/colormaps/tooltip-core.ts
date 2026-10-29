import { rgbToHex } from '../core/color.ts';
import type { ColormapEntry, Rgb } from '../types/index.ts';

// The pure parts of the colormap tooltip, shared by the React
// TooltipProvider: what it says about one color, and where it goes.

export interface TipInfo {
  hex: string;
  c: Rgb;
  text: string[];
  title: string;
}

/** The tooltip for color `i` of a strip: hex, rgb, position and L*. */
export function tipInfo(map: ColormapEntry, viewLabel: string, colors: Rgb[], Ls: number[], i: number): TipInfo {
  const n = colors.length;
  const c = colors[i];
  const hex = rgbToHex(c);
  const pos = map.kind === 'qualitative' ? `color ${i + 1} of ${n}` : `t = ${(n > 1 ? i / (n - 1) : 0).toFixed(3)}`;
  return {
    hex,
    c,
    text: [hex, `rgb(${c[0]}, ${c[1]}, ${c[2]})`, pos, `L* = ${Ls[i].toFixed(1)}`],
    title: `${map.name} · ${viewLabel}`,
  };
}

/** Top-left of a tooltip of size w x h for a pointer at (x, y), kept inside the viewport vw x vh. */
export function tipPosition(x: number, y: number, w: number, h: number, vw: number, vh: number) {
  let left = x + 14;
  let top = y + 16;
  if (left + w > vw - 4) left = x - w - 14;
  if (top + h > vh - 4) top = y - h - 12;
  return { left: Math.max(4, left), top: Math.max(4, top) };
}

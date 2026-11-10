// Snapping a rough colorbar placement onto the figure: the colorbar's strip
// and its ends (refineColorbar).
import { chroma, deltaE76, rgbToLab } from './color.ts';
import { readPixel } from './pixels.ts';
import { median } from './stats.ts';
import type { Lab, PixelImage, Point } from './types.ts';

/** refineColorbar's answer. */
export interface RefinedColorbar {
  start: Point;
  end: Point;
  halfWidth: number;
  stripHalf: number;
  found: { start: boolean; end: boolean };
  moved: { sideways: number; start: number; end: number };
}

// An LLM reading coordinates off images places the colorbar and its ticks
// a few pixels off: the line drifts towards the strip's edge, the ends land
// on the outline or short of the last color, and ticks miss their marks.
// These functions find the real strip and tick marks near a rough
// placement. Color steps are ΔE76 in CIELAB.

const SIDE_EDGE = 15; // sideways step that counts as leaving the strip
const MAX_SIDE = 60; // widest half-strip searched, in pixels
// Figure colorbars are horizontal or vertical: a line whose sideways run is
// under this share of its length is straightened.
const STRAIGHTEN = 0.07;
const MIN_LEN = 10; // shortest line (pixels) worth refining or snapping on
// A colorbar changes color along its length: the middle must span at least
// this ΔE76, or the line is not on a bar.
const MIN_SPREAD = 10;
// An end is a step along the bar bigger than END_JUMP ΔE76 and END_JUMP_X
// times the bar's median step (smooth bars have tiny steps, binned ones
// bigger steps between bins).
const END_JUMP = 12;
const END_JUMP_X = 5;
const STRIP_CHROMA = 8; // past an inner step, a color this colorful is still strip, not background
const labAt = (img: PixelImage, p: Point) => rgbToLab(readPixel(img, p.x, p.y));

function axes(start: Point, end: Point) {
  const len = Math.hypot(end.x - start.x, end.y - start.y);
  const u = { x: (end.x - start.x) / len, y: (end.y - start.y) / len };
  const n = { x: -u.y, y: u.x };
  // Page point at s pixels along the bar from start and k pixels across it.
  const at = (s: number, k = 0): Point => ({ x: start.x + s * u.x + k * n.x, y: start.y + s * u.y + k * n.y });
  return { len, u, n, at };
}

// How far the strip reaches on each side of the line (last pixel that still
// has the line's color), as medians over the middle of the bar. A colorbar
// has one color across its width, so the first big sideways step is its edge.
function stripSides(img: PixelImage, start: Point, end: Point) {
  const { len, at } = axes(start, end);
  const lo: number[] = [];
  const hi: number[] = [];
  const centre: Lab[] = [];
  for (let i = 0; i < 15; i++) {
    const s = len * (0.2 + (0.6 * i) / 14);
    const c = labAt(img, at(s));
    centre.push(c);
    const reach = (dir: number) => {
      let k = 0;
      while (k < MAX_SIDE && deltaE76(labAt(img, at(s, dir * (k + 1))), c) < SIDE_EDGE) k++;
      return k;
    };
    lo.push(reach(-1));
    hi.push(reach(1));
  }
  // A colorbar changes color along its length; a flat line is not on one.
  let spread = 0;
  for (const c of centre) spread = Math.max(spread, deltaE76(c, centre[0]));
  return { lo: median(lo), hi: median(hi), spread };
}

// Rough colorbar line → the strip's centre line with both ends on its last
// colored pixels. Returns {start, end, halfWidth (for sampling), stripHalf,
// found: {start, end}, moved: {sideways, start, end}} or null when no strip
// is found under the line (the rough placement is then kept).
export function refineColorbar(img: PixelImage, start: Point, end: Point): RefinedColorbar | null {
  // Figure colorbars are horizontal or vertical: a line tilted by a few
  // degrees would drift towards one side, so straighten it about its middle.
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < STRAIGHTEN * Math.abs(dy)) {
    const mx = (start.x + end.x) / 2;
    [start, end] = [
      { x: mx, y: start.y },
      { x: mx, y: end.y },
    ];
  } else if (Math.abs(dy) < STRAIGHTEN * Math.abs(dx)) {
    const my = (start.y + end.y) / 2;
    [start, end] = [
      { x: start.x, y: my },
      { x: end.x, y: my },
    ];
  }
  const rough = axes(start, end);
  if (rough.len < MIN_LEN) return null;
  const { lo, hi, spread } = stripSides(img, start, end);
  if (spread < MIN_SPREAD || lo + hi < 2 || lo >= MAX_SIDE || hi >= MAX_SIDE) return null;
  const shift = (hi - lo) / 2;
  const half = (hi + lo) / 2;
  const s0 = rough.at(0, shift);
  const { len, at } = axes(s0, rough.at(rough.len, shift));
  const on = (s: number) => labAt(img, at(s));

  // Steps along the bar inside it; an end is a step much bigger than these.
  const steps: number[] = [];
  for (let s = Math.round(len * 0.3); s < len * 0.7; s++) steps.push(deltaE76(on(s), on(s + 1)));
  const jump = Math.max(END_JUMP, END_JUMP_X * median(steps));
  const W = Math.max(8, Math.min(Math.round(len * 0.12), Math.floor(len * 0.35)));
  const out = half + 3;

  // Walk outward across the rough end (s0 along the bar, dir ±1). The end is
  // the first big step, from the inside out, into something that looks like
  // the surroundings (the outline or background beside the strip, or a gray).
  function findEnd(sEnd: number, dir: number) {
    for (let j = -W + 1; j <= W; j++) {
      const prev = on(sEnd + dir * (j - 1));
      const cur = on(sEnd + dir * j);
      const d = deltaE76(prev, cur);
      if (d <= jump) continue;
      const s = sEnd + dir * (j + 1);
      const past = on(s);
      const side = Math.min(deltaE76(past, labAt(img, at(s, -out))), deltaE76(past, labAt(img, at(s, out))));
      if (side >= SIDE_EDGE * 1.5 && chroma(past) >= STRIP_CHROMA) continue; // an inner step (e.g. a discrete bar)
      // Last clean pixel: step back over an anti-aliased edge pixel, then one more.
      let e = j - 1;
      for (let k = 0; k < 2 && deltaE76(on(sEnd + dir * (e - 1)), on(sEnd + dir * e)) > 0.3 * d; k++) e--;
      return sEnd + dir * (e - 1);
    }
    return null;
  }
  const sStart = findEnd(0, -1);
  const sEnd = findEnd(len, 1);
  const a = sStart ?? 0;
  const b = sEnd ?? len;
  if (b - a < Math.max(5, len * 0.5)) return null;
  const r = (v: number) => Math.round(v * 10) / 10;
  const p = (s: number) => ({ x: r(at(s).x), y: r(at(s).y) });
  return {
    start: p(a),
    end: p(b),
    // Sample the middle half of the strip, away from its anti-aliased sides.
    halfWidth: Math.max(0, Math.min(6, Math.floor(half / 2))),
    stripHalf: half,
    found: { start: sStart !== null, end: sEnd !== null },
    moved: { sideways: r(shift), start: r(-a), end: r(b - len) },
  };
}

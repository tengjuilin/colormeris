// Finding colorbars on a page and snapping a rough box to a strip.

import type { Box, PixelImage, Rgb } from '../../types/index.ts';
import { readPixel } from '../grid.ts';
import type { BarTools } from './bar-strips.ts';
import { BAR_STEP, BAR_THICK, barTools, followStrip } from './bar-strips.ts';
import { components, median } from './helpers.ts';
import type { Bar, BarCandidate, StripKind } from './types.ts';

// What the colors along a strip look like: the median color of each
// line across it. Gradual change along it makes a smooth colorbar, 5 or
// more flat bins a binned one, 4 or fewer a categorical strip (a group
// legend), unless the strip changes across (text, a heatmap block): then
// it is not a colorbar at all (null).
function stripKind(img: PixelImage, bar: Bar): StripKind | null {
  const v = bar.vertical;
  const [a, b, c0, c1] = v ? [bar.y0, bar.y1, bar.x0, bar.x1] : [bar.x0, bar.x1, bar.y0, bar.y1];
  const m = c1 - c0 > 6 ? 1 : 0;
  const px = (u: number, c: number) => (v ? readPixel(img, c, u) : readPixel(img, u, c));
  // Each line's median color, and whether most of the line is near it
  // (text written over a bar, as t9's "z-score", covers less than half).
  const means: Rgb[] = [];
  let uneven = 0;
  for (let u = a; u < b; u++) {
    const line: Rgb[] = [];
    for (let c = c0 + m; c < c1 - m; c++) line.push(px(u, c));
    const med = [0, 1, 2].map((i) => median(line.map((rgb) => rgb[i])));
    means.push(med);
    const near = line.filter((rgb) => rgb.every((x, i) => Math.abs(x - med[i]) <= 30)).length;
    if (near < 0.6 * line.length) uneven++;
  }
  if (uneven > 0.2 * means.length) return null;
  // Steps over 3 lines larger than BAR_STEP are bin edges (a blurred edge
  // spans a few lines).
  const diff = (p: Rgb, q: Rgb) => Math.max(...p.map((x, k: number) => Math.abs(x - q[k])));
  let jumps = 0;
  for (let i = 0, inJump = false; i + 1 < means.length; i++) {
    const jump = diff(means[i], means[Math.min(means.length - 1, i + 3)]) > BAR_STEP;
    if (jump && !inJump) jumps++;
    inJump = jump;
  }
  // Stretches of nearly one color, and how many colors they have: a
  // categorical strip repeats a few colors (2 to 4 groups, often with
  // lines between cells), each stretch the same as or far from the one
  // before; a gradient (even a pale one) steps a little at a time, and
  // a colorbar's bins all differ.
  const colors: Rgb[] = [];
  const stretches: Stretch[] = [];
  let flat = 0;
  let gradual = 0;
  let last: Rgb | null = null;
  for (let i = 0; i < means.length; ) {
    let j = i + 1;
    while (j < means.length && diff(means[j], means[i]) <= BAR_STEP / 3) j++;
    if (j - i >= Math.max(3, 0.02 * means.length)) {
      flat += j - i;
      stretches.push({ i, j, rgb: means[i] });
      if (!colors.some((c) => diff(c, means[i]) <= 2 * BAR_STEP)) colors.push(means[i]);
      if (last && diff(last, means[i]) > 4 && diff(last, means[i]) <= 2 * BAR_STEP) gradual++;
      last = means[i];
    }
    i = j;
  }
  if (jumps >= 1 && colors.length <= 4 && flat >= 0.8 * means.length && gradual <= 1) return 'categorical';
  // One color in 3 or more stretches with another color between them: a
  // row of label boxes (t13's yellow "Tails" boxes with names on them), a
  // group strip of cells split by white lines (t9's "Group", whose 4 groups
  // blur into more than 4 colors) or a row of heatmap cells. A colorbar's
  // bins all differ, and a gradient never comes back to a color.
  const apart = (a: Stretch, b: Stretch) => {
    for (let k = a.j; k < b.i; k++) if (diff(means[k], a.rgb) > 25) return true;
    return false;
  };
  for (const s of stretches) {
    let n = 1;
    let prev = s;
    for (const t of stretches) if (t.i > prev.i && diff(t.rgb, s.rgb) <= 8 && apart(prev, t)) [n++, (prev = t)];
    if (n >= 3) return 'categorical';
  }
  return jumps >= 4 ? 'binned' : 'smooth';
}

interface Stretch {
  i: number;
  j: number;
  rgb: Rgb;
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// Every colorbar candidate in `region` (the whole page by default), with
// `exclude` boxes (heatmap cells) left out: [{x0, y0, x1, y1, vertical,
// kind}] with kind 'smooth', 'binned' or 'categorical' (a group strip; a
// bar of 4 bins or fewer looks the same), longest first. Gray-only
// colormaps are missed, and a white end without a frame is cut off.
export function findColorbars(
  img: PixelImage,
  { region = null, exclude = [] }: { region?: Box | null; exclude?: Box[] } = {},
): BarCandidate[] {
  region ??= { x0: 0, y0: 0, x1: img.width, y1: img.height };
  const B = barTools(img, region);
  const out: BarCandidate[] = [];
  const grown = exclude.map((b) => ({ x0: b.x0 - 2, y0: b.y0 - 2, x1: b.x1 + 2, y1: b.y1 + 2 }));
  const excluded = (x: number, y: number) => grown.some((b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1);
  const comps = components(B.x0, B.y0, B.x1, B.y1, (x, y) => B.colored(readPixel(img, x, y)) && !excluded(x, y));
  // Big pieces first, so the halves of a diverging bar join the first one's strip.
  comps.sort((a, b) => b.n - a.n);
  for (const c of comps) {
    const w = c.x1 - c.x0;
    const h = c.y1 - c.y0;
    if (Math.min(w, h) < BAR_THICK || Math.max(w, h) < 1.5 * Math.min(w, h) || c.n < 0.5 * w * h) continue;
    if (out.some((b) => overlaps(b, c))) continue;
    const bar = followStrip(img, B, c, h >= w);
    if (!bar || out.some((b) => overlaps(b, bar)) || grown.some((b) => overlaps(b, bar)) || dashed(img, B, bar))
      continue;
    const kind = stripKind(img, bar);
    if (kind) out.push({ ...bar, kind });
  }
  const len = (b: Bar) => (b.vertical ? b.y1 - b.y0 : b.x1 - b.x0);
  return mergeFragments(img, B, out).sort((a, b) => len(b) - len(a));
}

// A dashed or dotted line (t16's outline around a group of cells, 6 px
// thick, 65 dashes) followed as a strip over its short gaps: along its
// middle less than 90% is off the page, in 3 or more gaps. A diverging
// bar's white middle is one gap.
function dashed(img: PixelImage, B: BarTools, bar: Bar) {
  const v = bar.vertical;
  const [a, b] = v ? [bar.y0, bar.y1] : [bar.x0, bar.x1];
  const c = Math.floor(v ? (bar.x0 + bar.x1) / 2 : (bar.y0 + bar.y1) / 2);
  const offPage = [];
  for (let u = a; u < b; u++) offPage.push(B.pale(v ? readPixel(img, c, u) : readPixel(img, u, c)));
  const on = offPage.filter(Boolean).length;
  // Gaps of 2 px or more between dashes of 3 px or more (noise in a white
  // middle flickers pixel by pixel).
  let gaps = 0;
  for (let i = 0; i < offPage.length; ) {
    let j = i;
    while (j < offPage.length && offPage[j] === offPage[i]) j++;
    if (
      !offPage[i] &&
      j - i >= 2 &&
      i >= 3 &&
      offPage.slice(i - 3, i).every(Boolean) &&
      offPage.slice(j, j + 3).length === 3 &&
      offPage.slice(j, j + 3).every(Boolean)
    )
      gaps++;
    i = j;
  }
  return on < 0.9 * (b - a) && gaps >= 3;
}

// Pieces of one strip: a diverging bar whose white middle is only a few
// levels off the page (t16: 242 on 255) is followed as two strips. Two
// strips end to end on the same line, the gap between them shorter than
// the strip is thick and 8% of their length, with no dark line across it
// (two framed bars stacked), are one.
function mergeFragments(img: PixelImage, B: BarTools, bars: BarCandidate[]): BarCandidate[] {
  const out = [...bars];
  for (let i = 0; i < out.length; i++)
    for (let j = i + 1; j < out.length; j++) {
      const [p, q] = [out[i], out[j]];
      if (p.vertical !== q.vertical) continue;
      const v = p.vertical;
      const [pa, pb, qa, qb] = v ? [p.y0, p.y1, q.y0, q.y1] : [p.x0, p.x1, q.x0, q.x1];
      const [pc0, pc1, qc0, qc1] = v ? [p.x0, p.x1, q.x0, q.x1] : [p.y0, p.y1, q.y0, q.y1];
      const thick = Math.min(pc1 - pc0, qc1 - qc0);
      if (Math.abs(pc0 - qc0) > 3 || Math.abs(pc1 - qc1) > 3) continue;
      const [g0, g1] = pb <= qa ? [pb, qa] : [qb, pa];
      const gap = g1 - g0;
      const len = Math.max(pb, qb) - Math.min(pa, qa);
      if (gap < 0 || gap > thick || gap > 0.08 * len) continue;
      const c = Math.floor((pc0 + pc1) / 2);
      let dark = false;
      for (let u = g0; u < g1; u++) if (B.strong(v ? readPixel(img, c, u) : readPixel(img, u, c))) dark = true;
      if (dark) continue;
      const box = {
        x0: Math.min(p.x0, q.x0),
        y0: Math.min(p.y0, q.y0),
        x1: Math.max(p.x1, q.x1),
        y1: Math.max(p.y1, q.y1),
        vertical: v,
      };
      const kind = stripKind(img, box);
      if (!kind) continue;
      out.splice(j, 1);
      out[i] = { ...box, kind };
      j = i;
    }
  return out;
}

// The colored strip of a colorbar from a rough box around it (a decision
// model's answer, or an LLM's): the strip through the box, followed to
// its ends as findColorbars does, without its frame. Null when the box
// holds no strip.
export function snapStrip(img: PixelImage, box: Box): Box | null {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  if (!(w > 2 && h > 2)) return null;
  const B = barTools(img, {
    x0: box.x0 - w * 0.25 - 10,
    y0: box.y0 - h * 0.25 - 10,
    x1: box.x1 + w * 0.25 + 10,
    y1: box.y1 + h * 0.25 + 10,
  });
  const bar = followStrip(img, B, box, h >= w) || followStrip(img, B, box, h < w);
  return bar && { x0: bar.x0, y0: bar.y0, x1: bar.x1, y1: bar.y1 };
}

// The colored strip of a colorbar in a rough box an LLM read off the page
// rulers (use_colorbar box). A diverging bar can stop at its pale middle
// (t16: half the bar), so the rest of the box is snapped too and pieces on
// the same line joined; a strip still under 70% of the box's length is
// extended to the box (`extended`, with `share`, the strip's share of the
// box before that). Returns {bar, share, extended} or null.
export function snapStripBox(img: PixelImage, box: Box) {
  let bar = snapStrip(img, box);
  if (!bar) return null;
  const v = bar.y1 - bar.y0 >= bar.x1 - bar.x0;
  const along = (b: Box) => (v ? [b.y0, b.y1] : [b.x0, b.x1]);
  const across = (b: Box) => (v ? [b.x0, b.x1] : [b.y0, b.y1]);
  const [b0, b1] = along(box);
  const thick = across(bar)[1] - across(bar)[0];
  const len = (b: Box) => along(b)[1] - along(b)[0];
  for (const [a0, a1] of [
    [b0, along(bar)[0]],
    [along(bar)[1], b1],
  ]) {
    if (a1 - a0 < 2 * thick) continue;
    const piece = snapStrip(img, v ? { ...box, y0: a0, y1: a1 } : { ...box, x0: a0, x1: a1 });
    if (!piece || Math.abs(across(piece)[0] - across(bar)[0]) > 3 || Math.abs(across(piece)[1] - across(bar)[1]) > 3)
      continue;
    bar = {
      x0: Math.min(bar.x0, piece.x0),
      y0: Math.min(bar.y0, piece.y0),
      x1: Math.max(bar.x1, piece.x1),
      y1: Math.max(bar.y1, piece.y1),
    };
  }
  const share = len(bar) / Math.max(1, b1 - b0);
  if (share >= 0.7) return { bar, share, extended: false };
  const out = v
    ? { ...bar, y0: Math.min(bar.y0, Math.round(b0)), y1: Math.max(bar.y1, Math.round(b1)) }
    : { ...bar, x0: Math.min(bar.x0, Math.round(b0)), x1: Math.max(bar.x1, Math.round(b1)) };
  return { bar: out, share, extended: true };
}

// A colorbar strip inside `region`, found without a decision model's box:
// the longest smooth or binned strip found by findColorbars (a
// categorical one only when there is nothing else). `exclude`: heatmap
// cells to leave out. A fallback for when a box answer for the colorbar is off.
export function findStrip(img: PixelImage, region: Box, { exclude = [] }: { exclude?: Box[] } = {}): Box | null {
  if (region.x1 - region.x0 < 4 || region.y1 - region.y0 < 4) return null;
  const bars = findColorbars(img, { region, exclude });
  const best = bars.find((b) => b.kind !== 'categorical') || bars[0];
  return best ? { x0: best.x0, y0: best.y0, x1: best.x1, y1: best.y1 } : null;
}

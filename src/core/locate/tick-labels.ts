// findTickLabels: the numbered labels beside a colorbar strip.

import type { Box, PixelImage } from '../../types/index.ts';
import { readPixel } from '../grid.ts';
import { background, clamp, components, differs, mean, median, STRONG, TEXT } from './helpers.ts';
import { tickMarks } from './tick-marks.ts';
import type { Component, FrameComp, TickBest, TickLabel, TickLabelsResult } from './types.ts';

// Tick labels beside a colorbar strip `bar` (a box around the colored
// strip). Dark text is split into characters and grouped into labels; on
// each side of the bar the row of labels nearest the strip is scored, and
// the better side wins. Picking the side with more labels took a
// heatmap's row labels, its column labels, a neighbour's cells or a
// rotated title. A side scores by its labels that lie along the strip
// (a row of labels running past the bar's ends belongs to something
// else), roughly evenly spaced, close to the strip, and on tick marks
// when it has any. Left out: tick marks, a title further out, a run of
// single characters stacked along a vertical bar (a rotated title),
// colored blobs (another colorbar) and anything in `options.exclude`
// (heatmap cells). Returns {side, marks: [{at, box}], score}: `at` is the
// label's middle projected onto the strip's centre line, in reading order
// (top to bottom for a vertical bar, left to right for a horizontal one).
export function findTickLabels(
  img: PixelImage,
  bar: Box,
  { exclude = [] }: { exclude?: Box[] } = {},
): TickLabelsResult {
  const vertical = bar.y1 - bar.y0 >= bar.x1 - bar.x0;
  const len = vertical ? bar.y1 - bar.y0 : bar.x1 - bar.x0;
  const thick = vertical ? bar.x1 - bar.x0 : bar.y1 - bar.y0;
  const reach = vertical ? Math.max(70, 6 * thick) : Math.max(40, 3 * thick);
  // The window runs a quarter of the strip past its ends, to see a row
  // of labels go on past them.
  const pad = Math.max(12, Math.round(len * 0.25));
  const [b0, b1] = vertical ? [bar.y0, bar.y1] : [bar.x0, bar.x1];
  const sides = vertical ? ['right', 'left'] : ['below', 'above'];
  const excluded = (x: number, y: number) => exclude.some((b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1);
  // Tick marks drawn inside the strip on one side: short strokes in its
  // outer 4 lines, much darker than its middle (frame caps aside).
  const innerTicks = (side: string) => {
    const out: number[] = [];
    const far = side === 'right' || side === 'below';
    const e = far ? (vertical ? bar.x1 : bar.y1) - 1 : vertical ? bar.x0 : bar.y0;
    const c = Math.round(vertical ? (bar.x0 + bar.x1) / 2 : (bar.y0 + bar.y1) / 2);
    const px = (u: number, k: number) => (vertical ? readPixel(img, k, u) : readPixel(img, u, k));
    let run: number[] = [];
    for (let u = b0; u <= b1; u++) {
      const m = mean(px(u, c));
      const hit = u > b0 + 3 && u < b1 - 3 && [1, 2, 3].some((i) => mean(px(u, e + (far ? -i : i))) < m - STRONG);
      if (hit) run.push(u);
      else if (run.length) [run.length <= 4 && out.push((run[0] + run[run.length - 1]) / 2), (run = [])];
    }
    return out;
  };
  let best: {
    side: string;
    score: number;
    marks?: never[];
    on?: TickLabel[];
    row?: TickLabel[];
    charH?: number;
    ticks?: number[];
  } = { side: sides[0], marks: [], score: 0 };
  for (const side of sides) {
    // Window beside the strip: `across` runs away from the strip, `along` with it.
    const far = side === 'right' || side === 'below';
    const edge = far ? (vertical ? bar.x1 : bar.y1) : vertical ? bar.x0 : bar.y0;
    const [c0, c1] = far ? [edge, edge + reach] : [edge - reach, edge];
    const [x0, x1, y0, y1] = vertical ? [c0, c1, b0 - pad, b1 + pad] : [b0 - pad, b1 + pad, c0, c1];
    const wx0 = clamp(Math.round(x0), 0, img.width - 1);
    const wx1 = clamp(Math.round(x1), wx0 + 1, img.width);
    const wy0 = clamp(Math.round(y0), 0, img.height - 1);
    const wy1 = clamp(Math.round(y1), wy0 + 1, img.height);
    if (wx1 - wx0 < 3 || wy1 - wy0 < 3) continue;
    const dark = differs(background(img, wx0, wy0, wx1, wy1), TEXT);
    const comps = components(wx0, wy0, wx1, wy1, (x, y) => !excluded(x, y) && dark(readPixel(img, x, y)));
    // In the bar's frame: along (u) and distance from the strip (d).
    const frame = (c: Component): FrameComp => ({
      ...c,
      u0: vertical ? c.y0 : c.x0,
      u1: vertical ? c.y1 : c.x1,
      d0: far ? (vertical ? c.x0 : c.y0) - edge : edge - (vertical ? c.x1 : c.y1),
      d1: far ? (vertical ? c.x1 : c.y1) - edge : edge - (vertical ? c.x0 : c.y0),
      size: vertical ? c.y1 - c.y0 : c.x1 - c.x0,
      across: vertical ? c.x1 - c.x0 : c.y1 - c.y0,
    });
    // Text is gray strokes; a solid blob (another colorbar's end) is not.
    const gray = (c: FrameComp | Component) => {
      const solid = c.n >= 0.7 * (c.x1 - c.x0) * (c.y1 - c.y0) && Math.min(c.x1 - c.x0, c.y1 - c.y0) > 6;
      const rgb = readPixel(img, (c.x0 + c.x1 - 1) / 2, (c.y0 + c.y1 - 1) / 2);
      return !solid && (Math.max(...rgb) - Math.min(...rgb) < 40 || c.n < 0.5 * (c.x1 - c.x0) * (c.y1 - c.y0));
    };
    const all = comps.map(frame);
    // Tick marks touch the strip and are thin along it.
    const marks = all.filter((c) => c.d0 <= 2 && c.size <= 3);
    const ticks = marks.map((c) => (c.u0 + c.u1) / 2).concat(innerTicks(side));
    const tickLen = marks.length ? median(marks.map((c) => c.d1)) : 0;
    // Outlines and axis lines run along most of the strip.
    const chars = all.filter((c) => !(c.d0 <= 2 && c.size <= 3) && c.size < len * 0.5 && c.n >= 3 && gray(c));
    if (!chars.length) continue;
    // Glyph height: along a vertical bar, across a horizontal one.
    const charH = median(chars.map((c) => (vertical ? c.size : c.across)));
    // Lines along the strip (pieces of its frame, an axis line) are long
    // and thin: not text. t4's frame left two such boxes among the labels.
    for (let i = chars.length - 1; i >= 0; i--)
      if (chars[i].size >= 2 * charH && chars[i].across <= 0.5 * charH) chars.splice(i, 1);
    // A rotated title along a vertical bar: 3 or more characters stacked
    // along it a few pixels apart (the letters of a word turned on its
    // side); the characters of a number sit side by side across it.
    if (vertical) {
      const byU = [...chars].sort((a, b) => a.u0 - b.u0);
      const stacked = new Set();
      for (let i = 0; i < byU.length; i++) {
        const chain = [byU[i]];
        for (let j = i + 1; j < byU.length; j++) {
          const p = chain[chain.length - 1];
          const c = byU[j];
          const gap = c.u0 - p.u1;
          if (gap > 0.35 * charH) break;
          if (gap >= -1 && Math.abs((c.d0 + c.d1) / 2 - (p.d0 + p.d1) / 2) < 0.5 * charH) chain.push(c);
        }
        if (chain.length >= 3) chain.forEach((c) => stacked.add(c));
      }
      for (let i = chars.length - 1; i >= 0; i--) if (stacked.has(chars[i])) chars.splice(i, 1);
      if (!chars.length) continue;
    }
    // Characters of one label: beside each other in one line of text
    // (overlapping along a vertical bar, close along a horizontal one).
    chars.sort((a, b) => a.u0 - b.u0 || a.d0 - b.d0);
    const labels = [];
    // One line of text is at most this tall: two lines of labels (t10's
    // "−1" and "−1.5") once joined through the glyphs of a rotated title
    // beside them.
    const lineH = 1.7 * charH;
    const fits = (l: TickLabel, c: Pick<TickLabel, 'u0' | 'u1' | 'd0' | 'd1'>) =>
      (vertical ? Math.max(l.u1, c.u1) - Math.min(l.u0, c.u0) : Math.max(l.d1, c.d1) - Math.min(l.d0, c.d0)) <= lineH;
    for (const c of chars) {
      // (an exponent sits a little higher than its number)
      const g = vertical
        ? labels.find(
            (l) =>
              c.u0 < l.u1 + 0.2 * charH &&
              l.u0 < c.u1 + 0.2 * charH &&
              c.d0 <= l.d1 + 0.5 * charH &&
              l.d0 <= c.d1 + 0.5 * charH &&
              fits(l, c),
          )
        : labels.find((l) => c.u0 <= l.u1 + Math.max(2, 0.6 * charH) && c.d0 < l.d1 && l.d0 < c.d1 && fits(l, c));
      if (g) {
        [g.u0, g.u1, g.d0, g.d1] = [
          Math.min(g.u0, c.u0),
          Math.max(g.u1, c.u1),
          Math.min(g.d0, c.d0),
          Math.max(g.d1, c.d1),
        ];
        g.box = {
          x0: Math.min(g.box.x0, c.x0),
          y0: Math.min(g.box.y0, c.y0),
          x1: Math.max(g.box.x1, c.x1),
          y1: Math.max(g.box.y1, c.y1),
        };
        g.n++;
      } else
        labels.push({ u0: c.u0, u1: c.u1, d0: c.d0, d1: c.d1, n: 1, box: { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 } });
    }
    // Pieces of one label that met in the wrong order ("55." and "60").
    for (let i = 0; i < labels.length; i++)
      for (let j = i + 1; j < labels.length; j++) {
        const [a, c] = [labels[i], labels[j]];
        const join = vertical
          ? c.u0 < a.u1 + 0.2 * charH &&
            a.u0 < c.u1 + 0.2 * charH &&
            c.d0 <= a.d1 + 0.5 * charH &&
            a.d0 <= c.d1 + 0.5 * charH
          : c.u0 <= a.u1 + Math.max(2, 0.6 * charH) &&
            a.u0 <= c.u1 + Math.max(2, 0.6 * charH) &&
            c.d0 < a.d1 &&
            a.d0 < c.d1;
        if (!join || !fits(a, c)) continue;
        [a.u0, a.u1, a.d0, a.d1] = [
          Math.min(a.u0, c.u0),
          Math.max(a.u1, c.u1),
          Math.min(a.d0, c.d0),
          Math.max(a.d1, c.d1),
        ];
        a.box = {
          x0: Math.min(a.box.x0, c.box.x0),
          y0: Math.min(a.box.y0, c.box.y0),
          x1: Math.max(a.box.x1, c.box.x1),
          y1: Math.max(a.box.y1, c.box.y1),
        };
        a.n += c.n;
        labels.splice(j, 1);
        j = i;
      }
    labels.sort((a, b) => a.u0 - b.u0);
    // A rotated title along a vertical bar: 3 or more glyphs (single, or
    // two touching) stacked with gaps of a few pixels; numbers along a
    // bar sit further apart.
    const title = new Set();
    if (vertical) {
      const glyph = (l: TickLabel) => l.n <= 2;
      for (let i = 0; i < labels.length; ) {
        let j = i + 1;
        while (
          j < labels.length &&
          glyph(labels[j]) &&
          glyph(labels[j - 1]) &&
          labels[j].u0 - labels[j - 1].u1 < 0.35 * charH &&
          Math.abs(labels[j].d0 - labels[j - 1].d0) < charH
        )
          j++;
        if (j - i >= 3) for (let k = i; k < j; k++) title.add(labels[k]);
        i = j;
      }
    }
    // Specks smaller than half a character are not labels.
    let row = labels.filter((l) => !title.has(l) && Math.max(l.box.x1 - l.box.x0, l.box.y1 - l.box.y0) >= 0.5 * charH);
    // Along the strip, give or take a quarter glyph.
    const tol = Math.max(3, 0.25 * charH);
    const mid = (l: TickLabel) => (l.u0 + l.u1) / 2;
    const along = (l: TickLabel) => mid(l) >= b0 - tol && mid(l) <= b1 + tol;
    if (!row.some(along)) continue;
    // Labels start near the strip; a title or axis name sits further out.
    const nearest = Math.min(...row.filter(along).map((l) => l.d0));
    row = row.filter((l) => l.d0 >= nearest - charH && l.d0 <= nearest + charH);
    // A row that runs on past the bar's ends is another figure's labels.
    const on = row.filter(along);
    const beyond = row.length - on.length;
    const gaps = on.slice(1).map((l, i) => mid(l) - mid(on[i]));
    const avg = gaps.reduce((s, g) => s + g, 0) / (gaps.length || 1);
    const cv = gaps.length > 1 ? Math.sqrt(gaps.reduce((s, g) => s + (g - avg) ** 2, 0) / gaps.length) / avg : 0;
    const even = cv < 0.35 ? 1 : 0.6;
    // Distance past the tick marks, in glyphs: a title or row labels
    // further out score less.
    const close = 1 / (1 + Math.max(0, nearest - tickLen - 0.5 * charH) / (2 * charH));
    const onTicks = on.filter((l) => ticks.some((t) => Math.abs(t - mid(l)) <= Math.max(5, 0.5 * charH))).length;
    // Tick labels spread over most of the strip; the glyphs of a rotated
    // title beside it (t14's "(RLU 1×10^5)") bunch up in its middle.
    const spread = on.length >= 3 ? (mid(on[on.length - 1]) - mid(on[0])) / len : 1;
    const score =
      (on.length >= 2 ? on.length : 0.5) *
        even *
        close *
        (on.length / (on.length + beyond)) *
        (spread < 0.5 ? 0.5 : 1) +
      onTicks;
    if (score > best.score) best = { side, score, on, row, charH, ticks };
  }
  if (!best.on) return { side: best.side, marks: [], score: 0 };
  return tickMarks(img, bar, best as TickBest, { vertical, len, b0, b1 });
}

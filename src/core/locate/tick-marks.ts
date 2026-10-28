// Bin steps of a binned bar and the tick marks built from the chosen label side.

import type { Box, PixelImage, Rgb } from '../../types/index.ts';
import { readPixel } from '../grid.ts';
import { BAR_STEP } from './bar-strips.ts';
import { background, differs, median } from './helpers.ts';
import type { TickBest, TickLabel, TickLabelsResult } from './types.ts';

// Positions of the steps between a binned colorbar's bins along it
// (line medians that change by more than BAR_STEP over 3 lines). Two
// steps within 12 px of each other are the sides of a line drawn across
// the bar (a tick mark), not a step: both are left out.
export function binEdges(img: PixelImage, bar: Box, vertical: boolean) {
  const [a, b, c0, c1] = vertical ? [bar.y0, bar.y1, bar.x0, bar.x1] : [bar.x0, bar.x1, bar.y0, bar.y1];
  const m = c1 - c0 > 6 ? 1 : 0;
  const means: Rgb[] = [];
  for (let u = a; u < b; u++) {
    const line: Rgb[] = [];
    for (let c = c0 + m; c < c1 - m; c++) line.push(vertical ? readPixel(img, c, u) : readPixel(img, u, c));
    means.push([0, 1, 2].map((i) => median(line.map((rgb) => rgb[i]))));
  }
  const diff = (p: Rgb, q: Rgb) => Math.max(...p.map((x, k: number) => Math.abs(x - q[k])));
  const out: number[] = [];
  for (let i = 0; i + 3 < means.length; ) {
    if (diff(means[i], means[i + 3]) <= BAR_STEP) {
      i++;
      continue;
    }
    let j = i;
    while (j + 3 < means.length && diff(means[j], means[j + 3]) > BAR_STEP) j++;
    out.push(a + (i + j + 3) / 2);
    i = j + 1;
  }
  return out.filter(
    (e, i) => !(Math.abs(e - (out[i - 1] ?? -Infinity)) < 12 || Math.abs((out[i + 1] ?? Infinity) - e) < 12),
  );
}

// The labels of the chosen side as marks, with what is not a tick label
// taken out or flagged. On a binned bar whose labels all sit on bin
// steps (or its ends) but one that is also out of step with the others,
// that one is a title: t2's and t3's "RLU" in the top bin. A label just past an end of the strip, in step with the
// others, over pale color, means the strip goes on there (t10's last "1"
// under a near-white end the strip search cut off): the bar is extended
// to it (`bar` in the result). Marks of an odd size are flagged with
// `note` for the LLM. Returns {side, marks: [{at, box, note?}], score,
// bar?}.
export function tickMarks(
  img: PixelImage,
  bar: Box,
  best: TickBest,
  { vertical, len, b0, b1 }: { vertical: boolean; len: number; b0: number; b1: number },
): TickLabelsResult {
  const { charH } = best;
  const mid = (l: TickLabel) => (l.u0 + l.u1) / 2;
  let on = best.on;
  const tol = Math.max(6, 0.6 * charH);
  const inner = binEdges(img, bar, vertical).filter((e) => e > b0 + tol && e < b1 - tol);
  const onStep = (l: TickLabel) => [b0, b1, ...inner].some((e) => Math.abs(e - mid(l)) <= tol);
  const off = on.filter((l) => !onStep(l));
  const onInner = on.filter((l) => inner.some((e) => Math.abs(e - mid(l)) <= tol)).length;
  if (off.length === 1 && onInner >= 2 && on.length - 1 >= 3) {
    // ... and out of step with the evenly spaced others (t7's ticks fall
    // between bins at a tick mark; they stay).
    const rest = on.filter((l) => l !== off[0]).map(mid);
    const step = median(rest.slice(1).map((u, i) => u - rest[i]));
    const k = Math.round((mid(off[0]) - rest[0]) / step);
    if (Math.abs(mid(off[0]) - (rest[0] + k * step)) > Math.max(tol, 0.08 * step)) on = on.filter((l) => l !== off[0]);
  }
  const gaps = on.slice(1).map((l, i) => mid(l) - mid(on[i]));
  const avg = gaps.reduce((s, g) => s + g, 0) / (gaps.length || 1);
  const cv = gaps.length > 1 ? Math.sqrt(gaps.reduce((s, g) => s + (g - avg) ** 2, 0) / gaps.length) / avg : 1;
  // A label past an end in step with the rest.
  let extended = null;
  if (on.length >= 3 && cv < 0.15) {
    // (t10's end is 5–11 levels off the white page)
    const bg = background(
      img,
      Math.max(0, bar.x0 - 20),
      Math.max(0, bar.y0 - 20),
      Math.min(img.width, bar.x1 + 20),
      Math.min(img.height, bar.y1 + 20),
    );
    const pale = differs(bg, 4);
    const c = Math.round(vertical ? (bar.x0 + bar.x1) / 2 : (bar.y0 + bar.y1) / 2);
    const offPage = (from: number, to: number) => {
      let n = 0;
      let t = 0;
      for (let u = Math.round(from); u < to; u++, t++)
        if (pale(vertical ? readPixel(img, c, u) : readPixel(img, u, c))) n++;
      return t > 0 && n >= 0.8 * t;
    };
    for (const l of best.row) {
      if (on.includes(l)) continue;
      const [end, next] = mid(l) > b1 ? [b1, mid(on[on.length - 1]) + avg] : [b0, mid(on[0]) - avg];
      const past = Math.abs(mid(l) - end);
      if (Math.abs(mid(l) - next) > 0.25 * avg || past > 0.6 * avg || !(mid(l) > b1 || mid(l) < b0)) continue;
      if (!(mid(l) > b1 ? offPage(b1, mid(l)) : offPage(mid(l), b0))) continue;
      on = [...on, l].sort((p, q) => mid(p) - mid(q));
      extended = mid(l) > b1 ? { b1: Math.round(mid(l)) + 1 } : { b0: Math.round(mid(l)) };
    }
  }
  // Odd sizes: far more characters or a far larger box than the others.
  const sizes = on.map((l) => (l.box.x1 - l.box.x0) * (l.box.y1 - l.box.y0));
  const typical = median(sizes);
  const glyphs = median(on.map((l) => l.n));
  const m = vertical ? (bar.x0 + bar.x1) / 2 : (bar.y0 + bar.y1) / 2;
  // Labels without tick marks (user decision 2026-10-17): the first and
  // last label label the strip's ends when they sit at them, within half
  // their size and a tenth of the label spacing (t16: "0" and "100" 4 and 8
  // px inside the ends of a 385 px bar, 186 px apart); the others mark the
  // strip at their text's middle. Evenly spaced labels 10–13 px inside the
  // ends, a quarter of their spacing (t10, t11), stay: the bar runs on.
  const [e0, e1] = [extended?.b0 ?? b0, (extended?.b1 ?? b1) - 1];
  const place = (l: TickLabel, i: number) => {
    if (best.ticks?.length || on.length < 2 || (i > 0 && i < on.length - 1)) return mid(l);
    const end = i === 0 ? e0 : e1;
    return Math.abs(mid(l) - end) <= Math.min(Math.max(3, 0.6 * (l.u1 - l.u0)), 0.1 * avg) ? end : mid(l);
  };
  const marks = on.map((l, i) => {
    const odd = on.length >= 3 && (sizes[i] > 3 * typical || l.n > 2 * glyphs + 2);
    const u = place(l, i);
    return {
      at: vertical ? { x: m, y: u } : { x: u, y: m },
      box: l.box,
      ...(odd ? { note: 'larger than the other labels (a title, or two labels joined?)' } : {}),
    };
  });
  const out: TickLabelsResult = { side: best.side, marks, score: best.score };
  if (extended)
    out.bar = vertical
      ? { ...bar, y0: extended.b0 ?? bar.y0, y1: extended.b1 ?? bar.y1 }
      : { ...bar, x0: extended.b0 ?? bar.x0, x1: extended.b1 ?? bar.x1 };
  return out;
}

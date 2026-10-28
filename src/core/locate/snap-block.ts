// snapBlock: the filled block of cells inside a rough box.

import type { Box, PixelImage } from '../../types/index.ts';
import { clamp, FAINT_FILL, FILL, FRAME_GAP, FRAME_LINE, median, runs, SPAN_FILL } from './helpers.ts';
import { fitFrame, lineTools } from './line-tools.ts';
import type { PixelTest } from './types.ts';

// The filled block inside a rough box: the outermost runs of mostly-ink
// columns (then rows) that reach into the middle 60% of the box. Text
// labels never fill 75% of a band, and white lines between cells are
// bridged because the runs on both sides reach the middle. Then the block
// grows over lines of pale cells (a colormap that starts at white, as
// Blues does) and across white gaps between groups of cells, as long as
// the new lines look like cells: long runs of tinted color (not text,
// tick marks or a dendrogram's gray lines), the cells' grid lines kept
// (not a colorbar or a solid group strip), and nothing past a frame.
// Finally each edge moves onto the middle of a frame around the cells. A
// whole edge row or column of pure-white cells cannot be seen and is lost.
// `options.margin` (or a number) widens the search window around the box.
// Returns the snapped box, or null when no block is found.
export function snapBlock(img: PixelImage, box: Box, options: { margin?: number } | number = {}): Box | null {
  const { margin = 0.25 } = typeof options === 'number' ? { margin: options } : options;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  if (!(w > 2 && h > 2)) return null;
  const wx0 = clamp(Math.round(box.x0 - w * margin - 10), 0, img.width - 1);
  const wx1 = clamp(Math.round(box.x1 + w * margin + 10), wx0 + 1, img.width);
  const wy0 = clamp(Math.round(box.y0 - h * margin - 10), 0, img.height - 1);
  const wy1 = clamp(Math.round(box.y1 + h * margin + 10), wy0 + 1, img.height);
  const T = lineTools(img, wx0, wy0, wx1, wy1, {
    x0: box.x0 + 0.2 * w,
    y0: box.y0 + 0.2 * h,
    x1: box.x1 - 0.2 * w,
    y1: box.y1 - 0.2 * h,
  });
  const { ink, faint, pale, strong } = T;

  // Extent along one axis, from the share of ink in a band of the other.
  // `edges` is the block's extent on the other axis once known: grown
  // lines are then read over all of it, not only the band.
  const extent = (
    horizontal: boolean,
    lo: number,
    hi: number,
    bandLo: number,
    bandHi: number,
    inLo: number,
    inHi: number,
    core: PixelTest = ink,
    edges: [number, number] | null = null,
    inner: number[] = [],
    boxLen = 0,
  ): [number, number] | null => {
    const B = T.line(horizontal, bandLo, bandHi);
    const S = edges ? T.line(horizontal, edges[0], edges[1], 400) : T.line(horizontal, bandLo, bandHi, 400);
    const fill = B.share;
    const profile = [];
    for (let a = lo; a < hi; a++) profile.push(fill(a, core));
    let keep = runs(profile, lo).filter(([a, b]) => b >= inLo && a <= inHi);
    if (!keep.length) return null;
    // Separately framed blocks (t1: a block of 3 rows and its framed
    // Average row 11 px below): a gap of page (not pale cells) with a frame
    // line on both sides splits the runs, and the part holding the box's middle (else the
    // one overlapping it most) is the block.
    const frameEnd = (a: number, dir: number) => [0, 1, 2, 3].some((k) => fill(a + dir * k, strong) >= FILL);
    const splits = keep.slice(1).map((run, i) => {
      let blank = 0;
      for (let a = keep[i][1] + 1; a < run[0]; a++) if (fill(a, pale) < FAINT_FILL) blank++;
      return (
        run[0] - keep[i][1] > 2 &&
        blank >= 0.8 * (run[0] - keep[i][1] - 1) &&
        frameEnd(keep[i][1], -1) &&
        frameEnd(run[0], 1)
      );
    });
    // Every cell in its own frame (t18) splits everywhere, by gaps of one
    // width: one block.
    const widths = keep.slice(1).map((run, i) => run[0] - keep[i][1]);
    const eachFramed = splits.length >= 2 && splits.every(Boolean) && Math.max(...widths) - Math.min(...widths) <= 2;
    const parts: [number, number][][] = [[keep[0]]];
    for (let i = 1; i < keep.length; i++) {
      if (splits[i - 1] && !eachFramed) parts.push([keep[i]]);
      else parts[parts.length - 1].push(keep[i]);
    }
    if (parts.length > 1) {
      const c = (inLo + inHi) / 2;
      const span = (p: [number, number][]) => [p[0][0], p[p.length - 1][1]];
      const overlap = (p: [number, number][]) => Math.min(span(p)[1], inHi) - Math.max(span(p)[0], inLo);
      keep =
        parts.find((p) => span(p)[0] <= c && c <= span(p)[1]) ||
        parts.reduce((a, p) => (overlap(p) > overlap(a) ? p : a));
    }
    // Grow over pale cells, and past the window when the box cut the block short.
    let from = keep[0][0];
    let to = keep[keep.length - 1][1] + 1;
    const [core0, core1] = [from, to];
    const end = horizontal ? img.width : img.height;
    const inside = (a: number) => a >= 0 && a < end;
    // The cells' grid lines, read on the core: lines added to the block
    // must keep them.
    const sep = S.separators(from, to);
    const bordered = sep.filter((p) => p.kind === 'stroke').length >= 2;
    // A frame drawn around the cells is crossed too: a whole edge row of
    // near-white cells, then a thin gray line (at most FRAME_LINE px; a
    // colorbar or a neighbour's cells are thicker), within FRAME_GAP.
    // A line of pure-white cells inside a frame still touches the frame's
    // sides (`edges`: the block's ends on the other axis).
    const px = B.px;
    const framed = (a: number) =>
      !!edges &&
      [edges[0], edges[0] + 1].some((b) => ink(px(a, b))) &&
      [edges[1] - 1, edges[1] - 2].some((b) => ink(px(a, b)));
    const blankLine = (a: number) => fill(a, pale) < FAINT_FILL;
    // A dark grid line between two rows of pale cells (or a line blurred
    // out of the grid) is crossed when cells that keep the grid follow it;
    // an outer frame has none beyond it.
    const bridge = (a: number, dir: number) => {
      let k = 0;
      let gray = false;
      while (k < FRAME_LINE && inside(a + dir * k) && !grows(a + dir * k) && !blankLine(a + dir * k))
        [(gray ||= S.share(a + dir * k, strong) >= FILL), k++];
      if (!k || ![0, 1, 2].every((i) => grows(a + dir * (k + i)))) return 0;
      // Without grid lines seen in the cells, a gray line may be their
      // frame: crossed only into lines full of color across the whole
      // span (cells, not a colorbar beside them).
      return bordered ||
        !gray ||
        [0, 1, 2, 3, 4].every((i) => inside(a + dir * (k + i)) && S.share(a + dir * (k + i), faint) >= SPAN_FILL)
        ? k
        : 0;
    };
    // A line of cells: enough cell color in long runs, the grid kept; or
    // a line inside the frame that is not the frame itself.
    const grows = (a: number) =>
      inside(a) && ((S.cellRuns(a) >= FAINT_FILL && S.keepsGrid(a, sep)) || (framed(a) && S.share(a, strong) < FILL));
    // A block that already ends on its frame (a line of ink in one even
    // color, unlike cells) must not jump again, e.g. to a bracket beside
    // the heatmap. (A column of equally pale cells is even too, but no ink.)
    const even = (a: number) => {
      const lo = [255, 255, 255];
      const hi = [0, 0, 0];
      for (let b = Math.round(bandLo); b < bandHi; b += B.step)
        px(a, b).forEach((v, i) => ((lo[i] = Math.min(lo[i], v)), (hi[i] = Math.max(hi[i], v))));
      return hi.every((v, i) => v - lo[i] < 40) && fill(a, ink) >= FILL;
    };
    // The edge line or one of the two inside it (an anti-aliased frame).
    const framedEdge = (a: number, dir: number) => [0, 1, 2].some((i) => even(a + dir * i));
    // Cells without grid lines that end on a gray frame: nothing beyond
    // the frame is a cell (the halo and a colorbar right next to it are
    // not). With grid lines, keepsGrid tells pale cells from the rest.
    // A gray line inside the cells has cells on both sides.
    const closed = (a: number, dir: number) => {
      if (bordered) return false;
      const i = [0, 1, 2, 3].find((i) => S.share(a + dir * i, strong) >= FILL);
      if (i === undefined) return false;
      let o = a + dir * i;
      while (Math.abs(o - a) < 12 && inside(o) && S.share(o, strong) >= 0.5) o -= dir;
      return ![1, 2, 3, 4, 5].every((j) => inside(o - dir * j) && S.share(o - dir * j, faint) >= SPAN_FILL);
    };
    const gap = Math.max(8, Math.round((to - from) * FRAME_GAP));
    const full = (a: number) => inside(a) && fill(a, faint) >= FILL;
    const frameLine = (a: number) => !!edges && inside(a) && S.share(a, strong) >= FILL;
    const frame = (a: number, dir: number) => {
      let n = 0;
      while (n <= FRAME_LINE && frameLine(a + dir * n)) n++;
      return n <= FRAME_LINE ? n : 0;
    };
    // White lines between cells, or wider white gaps between groups of
    // cells (replicate columns), that cross the whole core: growth stops at
    // such a line on the block's edge, so a blank run as wide as one inside
    // the core is crossed when full cells follow it. A clean screenshot
    // has pure-white lines; the core held only the darker groups (12 of
    // 32 columns) and the rows between two white lines.
    // Widths are shared between the passes: the rows of one dark row
    // have no white line inside, but the columns do.
    for (let a = from, n = 0; a <= to; a++) {
      if (a < to && blankLine(a)) n++;
      else if (n) [inner.push(n), (n = 0)];
    }
    // Gaps as wide as 6% of the box count too: a core of the two darkest
    // of 5 rows (t16, 16 px gaps) is too short to allow its own gaps.
    const blankGap = Math.max(gap, Math.round(boxLen * FRAME_GAP));
    const widest = Math.min(blankGap, Math.max(0, ...inner));
    const likeInner = (k: number) => inner.some((n) => n <= blankGap && Math.abs(n - k) <= Math.max(1, 0.15 * n));
    const blankRun = (a: number, dir: number) => {
      let k = 0;
      while (k <= widest && inside(a + dir * k) && blankLine(a + dir * k)) k++;
      return k;
    };
    // Cells right past a blank run of `blank` lines (after an
    // anti-aliased edge line): at least 4 lines and as many as the run,
    // so an underline of the column labels is not taken for cells. They
    // cover the block's whole span (a colorbar beside the cells is
    // shorter) and keep its grid lines (a solid strip has none).
    // (The span's own white gaps between cells do not count against it.)
    const cellLine = (a: number) =>
      full(a) && (!edges || S.shareOff(a, faint, sep) >= SPAN_FILL) && S.keepsGrid(a, sep);
    const cellsAt = (a: number, dir: number, blank: number) =>
      [0, 1, 2].some((i) => {
        for (let j = 0; j < Math.max(4, blank); j++) if (!cellLine(a + dir * (i + j))) return false;
        return true;
      });
    // Cells set apart by white gaps, each with its own frame (t18) or
    // none (t16): the block's cells are runs of cell lines between gaps,
    // at an even pitch. A pale cell one pitch further on is taken in when
    // its lines past a gap as wide as the block's own are cell lines; a
    // wider gap (a separately framed block, t1) is not crossed. Only with
    // two or more cells of equal size in the block.
    const pitchOf = (lo: number, hi: number) => {
      const cells: [number, number][] = [];
      for (let a = lo; a < hi; a++) {
        if (!cellLine(a)) continue;
        let b = a;
        while (b + 1 < hi && cellLine(b + 1)) b++;
        if (b - a + 1 >= 4) cells.push([a, b + 1]);
        a = b;
      }
      if (cells.length < 2) return null;
      const sizes = cells.map(([a, b]) => b - a);
      const size = median(sizes);
      if (sizes.some((v) => Math.abs(v - size) > Math.max(2, 0.15 * size))) return null;
      const gaps = cells.slice(1).map(([a], i) => a - cells[i][1]);
      if (Math.min(...gaps) < 1) return null;
      return { pitch: median(cells.slice(1).map(([a], i) => a - cells[i][0])), gap: Math.max(...gaps), size };
    };
    // A pale cell beyond the edge `e` (the block's first line, or one past
    // its last) in direction `dir`: its lines past the gap are cell lines.
    const paleCell = (e: number, dir: number, P: { pitch: number; gap: number; size: number }) => {
      const near = P.gap + 2;
      const far = Math.round(near + 0.8 * P.size);
      for (let d = near; d <= far; d++) if (!inside(e + dir * d) || !cellLine(e + dir * d)) return false;
      return true;
    };
    if (!closed(from, 1)) {
      for (;;) {
        for (let k: number; from > 0 && (k = grows(from - 1) ? 1 : bridge(from - 1, -1)); ) from -= k;
        // A white gap may start inside the grown lines: JPEG ringing
        // makes it differ from the page by a few levels.
        let f = from;
        while (f < core0 && blankLine(f)) f++;
        const blank = f > 0 ? blankRun(f - 1, -1) : 0;
        if (blank && f - blank < from && likeInner(blank) && cellsAt(f - 1 - blank, -1, blank) && !framedEdge(f, 1)) {
          from = f - blank;
          continue;
        }
        const P = pitchOf(from, to);
        if (P && paleCell(from - 1, -1, P)) {
          from -= Math.round(P.pitch);
          continue;
        }
        let k = 1;
        while (k <= gap && from - k >= 0 && !frameLine(from - k)) k++;
        const n = k <= gap && !framedEdge(from, 1) ? frame(from - k, -1) : 0;
        // Nothing past the frame is a cell.
        if (n) from -= k + n - 1;
        break;
      }
    }
    if (!closed(to - 1, -1)) {
      for (;;) {
        for (let k: number; to < end && (k = grows(to) ? 1 : bridge(to, 1)); ) to += k;
        let t = to;
        while (t > core1 && blankLine(t - 1)) t--;
        const blank = blankRun(t, 1);
        if (blank && t + blank > to && likeInner(blank) && cellsAt(t + blank, 1, blank) && !framedEdge(t - 1, -1)) {
          to = t + blank;
          continue;
        }
        const P = pitchOf(from, to);
        if (P && paleCell(to, 1, P)) {
          to += Math.round(P.pitch);
          continue;
        }
        let k = 0;
        while (k < gap && !frameLine(to + k) && to + k < end) k++;
        const n = k < gap && !framedEdge(to - 1, -1) ? frame(to + k, 1) : 0;
        if (n) to += k + n;
        break;
      }
    }
    return [from, to];
  };

  const find = (core: PixelTest) => {
    const inner: number[] = []; // widths of white lines inside the block
    const xsIn: [number, number] = [box.x0 + w * 0.2, box.x1 - w * 0.2];
    const ysIn: [number, number] = [box.y0 + h * 0.2, box.y1 - h * 0.2];
    const mid = (s: number[]): [number, number] => [s[0] + (s[1] - s[0]) * 0.2, s[1] - (s[1] - s[0]) * 0.2];
    let xs = extent(true, wx0, wx1, box.y0 + h * 0.3, box.y1 - h * 0.3, ...xsIn, core, null, inner, w);
    if (!xs) return null;
    let ys = extent(false, wy0, wy1, ...mid(xs), ...ysIn, core, xs, inner, h);
    if (!ys) return null;
    // Once more across the rows actually found, so the band avoids labels;
    // and the rows again if the columns changed (the first pass read only
    // a band and may have run into a colorbar).
    const xs2 = extent(true, wx0, wx1, ...mid(ys), ...xsIn, core, ys, inner, w) || xs;
    if (xs2[0] !== xs[0] || xs2[1] !== xs[1])
      ys = extent(false, wy0, wy1, ...mid(xs2), ...ysIn, core, xs2, inner, h) || ys;
    xs = xs2;
    // Edges on the middle of a frame around the cells.
    const x0 = fitFrame(T, true, xs[0], 1, ys[0], ys[1], xs[1] - xs[0], img.width);
    const x1 = fitFrame(T, true, xs[1] - 1, -1, ys[0], ys[1], xs[1] - xs[0], img.width) + 1;
    const y0 = fitFrame(T, false, ys[0], 1, x0, x1, ys[1] - ys[0], img.height);
    const y1 = fitFrame(T, false, ys[1] - 1, -1, x0, x1, ys[1] - ys[0], img.height) + 1;
    return { x0, y0, x1, y1 };
  };
  // A diverging map around white (most cells pale) has no line that is 75%
  // strong ink; then the core is found from anything off the page color.
  return find(ink) || find(faint);
}

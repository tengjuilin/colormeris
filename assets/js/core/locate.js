(function (CM) {
  'use strict';
  const { readPixel } = CM;

  // Pixel-level finishing for rough boxes. A decision model such as Jev boxes
  // the cells of a heatmap or its colorbar to a few percent of the image;
  // these functions find the real block of color inside such a box and the
  // tick labels beside a colorbar strip. Boxes are {x0, y0, x1, y1} in image
  // pixels (x1, y1 exclusive).

  const FILL = 0.75; // share of ink along a line that makes it part of a block
  const INK = 40; // channel difference from the background that counts as ink
  // Growing a block over its palest cells: a line stays in the block while
  // this share of it is covered by runs of cell color (see `cellRuns`).
  const FAINT_FILL = 0.1;
  // Shortest run of cell color, in pixels, that counts in a grown line: tick
  // marks, dendrogram leaves and the strokes of text across it are thinner.
  const MIN_RUN = 5;
  // Furthest a frame line may sit past the block, as a share of its size.
  const FRAME_GAP = 0.06;
  const FRAME_LINE = 4;
  // Thickest frame (in lines) whose middle a block's edge moves to, and
  // thickest one taken in from outside the block (a blurred 2 px frame).
  const MAX_FRAME = 12;
  const THIN_FRAME = 6;
  // Lines across cells beyond a white gap must cover this share of the
  // block's whole span: a colorbar beside the cells is shorter (80% of
  // the cells' height in one figure).
  const SPAN_FILL = 0.85;
  const TEXT = 90; // channel difference from the background of dark text
  // Text, tick marks, frames and dendrograms are gray and much darker than
  // the page: lightness gap and largest chroma (max − min channel).
  const STRONG = 60;
  const NEUTRAL = 30;
  // Least chroma of a pale cell (unless the colormap is gray).
  const MIN_CHROMA = 6;
  // Gaps and white grid lines between cells are told from pale cells with
  // this tolerance at least: JPEG noise in a 5 px gap reaches 8 levels.
  const PALE = 14;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const median = (v) => {
    const s = [...v].sort((a, b) => a - b);
    return s.length ? s[s.length >> 1] : 0;
  };
  const mean = (rgb) => (rgb[0] + rgb[1] + rgb[2]) / 3;

  // Page background near a box: the most common color on the window's
  // border (in steps of 16). Not the median: the border can cross a
  // neighbouring heatmap or the colorbar for more than half its length.
  function background(img, x0, y0, x1, y1) {
    const bins = new Map();
    const add = (x, y) => {
      const rgb = readPixel(img, x, y);
      const key = rgb.map((v) => v >> 4).join();
      const b = bins.get(key) || { n: 0, sum: [0, 0, 0] };
      b.n++;
      rgb.forEach((v, i) => (b.sum[i] += v));
      bins.set(key, b);
    };
    for (let x = x0; x < x1; x += 2) [add(x, y0), add(x, y1 - 1)];
    for (let y = y0; y < y1; y += 2) [add(x0, y), add(x1 - 1, y)];
    let best = null;
    for (const b of bins.values()) if (!best || b.n > best.n) best = b;
    return best.sum.map((v) => v / best.n);
  }

  // How far the page itself strays from its background color (JPEG noise,
  // paper texture): the 90th percentile over the window's border pixels
  // that are near the background (within 10 levels: pale cells of a
  // neighbour on the border are not noise), doubled, and at least 4 levels.
  function noiseTol(img, x0, y0, x1, y1, bg) {
    const dev = [];
    const add = (x, y) => {
      const rgb = readPixel(img, x, y);
      const d = Math.max(Math.abs(rgb[0] - bg[0]), Math.abs(rgb[1] - bg[1]), Math.abs(rgb[2] - bg[2]));
      if (d < 10) dev.push(d);
    };
    for (let x = x0; x < x1; x += 2) [add(x, y0), add(x, y1 - 1)];
    for (let y = y0; y < y1; y += 2) [add(x0, y), add(x1 - 1, y)];
    dev.sort((a, b) => a - b);
    return Math.max(4, 2 * (dev[Math.floor(0.9 * (dev.length - 1))] || 0));
  }

  const differs = (bg, tol) => (rgb) => Math.max(Math.abs(rgb[0] - bg[0]), Math.abs(rgb[1] - bg[1]), Math.abs(rgb[2] - bg[2])) > tol;
  // Gray and much darker (or lighter) than the page: lines and text.
  const stroke = (bg) => (rgb) => Math.max(...rgb) - Math.min(...rgb) < NEUTRAL && Math.abs(mean(rgb) - mean(bg)) > STRONG;

  // Runs of positions where profile[i] >= FILL, as [from, to] (inclusive, offset by `lo`).
  function runs(profile, lo) {
    const out = [];
    for (let i = 0; i < profile.length; i++) {
      if (profile[i] < FILL) continue;
      let j = i;
      while (j + 1 < profile.length && profile[j + 1] >= FILL) j++;
      out.push([lo + i, lo + j]);
      i = j;
    }
    return out;
  }

  // Pixel tests and line measures around a rough box, shared by snapBlock
  // and snapEdges. A line is a column (`horizontal`: positions along x) or
  // a row, read over a span [s0, s1) of the other axis.
  function lineTools(img, wx0, wy0, wx1, wy1, inside) {
    const bg = background(img, wx0, wy0, wx1, wy1);
    const ink = differs(bg, INK);
    const tol = noiseTol(img, wx0, wy0, wx1, wy1, bg);
    const faint = differs(bg, tol);
    const pale = differs(bg, Math.max(tol, PALE));
    const strong = stroke(bg);
    const chroma = (rgb) => Math.max(...rgb) - Math.min(...rgb);
    // Gray cells (a gray colormap): most ink in the middle of the box is gray.
    let gray = 0;
    let inked = 0;
    for (let y = inside.y0; y < inside.y1; y += Math.max(1, (inside.y1 - inside.y0) / 30))
      for (let x = inside.x0; x < inside.x1; x += Math.max(1, (inside.x1 - inside.x0) / 30)) {
        const rgb = readPixel(img, x, y);
        if (ink(rgb)) [inked++, chroma(rgb) < 16 && gray++];
      }
    const grayCells = inked > 0 && gray >= 0.6 * inked;
    // Off the page, not a gray stroke and tinted (unless the cells are
    // gray): the color of cells, even pale ones. The gray halo of text and
    // lines is not.
    const tinted = (rgb) => faint(rgb) && !strong(rgb) && (grayCells || chroma(rgb) >= MIN_CHROMA);
    const line = (horizontal, s0, s1, n = 200) => {
      s0 = Math.round(s0);
      s1 = Math.max(s0 + 1, Math.round(s1));
      const step = Math.max(1, Math.floor((s1 - s0) / n));
      const px = (a, b) => (horizontal ? readPixel(img, a, b) : readPixel(img, b, a));
      const share = (a, test) => {
        let k = 0;
        let t = 0;
        for (let b = s0; b < s1; b += step, t++) if (test(px(a, b))) k++;
        return k / t;
      };
      // Share of the span covered by runs of cell color at least MIN_RUN
      // pixels long. Pale cells give long runs; tick marks, dendrogram
      // leaves and text give short runs or gray strokes.
      const cellRuns = (a) => {
        const minRun = Math.max(2, Math.ceil(MIN_RUN / step));
        let covered = 0;
        let run = 0;
        let t = 0;
        for (let b = s0; b < s1; b += step, t++) {
          if (tinted(px(a, b))) run++;
          else [run >= minRun && (covered += run), (run = 0)];
        }
        if (run >= minRun) covered += run;
        return covered / t;
      };
      // Runs of positions on the span where nearly all lines in [from, to)
      // are page or gray strokes: white or dark grid lines between cells,
      // as {i, j, kind} (sample indices, kind 'blank' or 'stroke').
      const separators = (from, to) => {
        const stride = Math.max(1, Math.floor((to - from) / 60));
        const kinds = [];
        for (let b = s0; b < s1; b += step) {
          let blank = 0;
          let dark = 0;
          let t = 0;
          for (let a = from; a < to; a += stride, t++) {
            const rgb = px(a, b);
            if (!pale(rgb)) blank++;
            else if (strong(rgb)) dark++;
          }
          kinds.push(blank >= 0.85 * t ? 'blank' : dark >= 0.85 * t ? 'stroke' : null);
        }
        const parts = [];
        for (let i = 0; i < kinds.length; ) {
          let j = i;
          while (j < kinds.length && kinds[j] === kinds[i]) j++;
          parts.push({ i, j, kind: kinds[i] });
          i = j;
        }
        // A frame near the span's ends is not a grid line, and neither is
        // a run as wide as half a cell (a column of white cells).
        const cell = median(parts.filter((p) => !p.kind).map((p) => p.j - p.i));
        const ends = Math.max(1, Math.round(0.03 * kinds.length));
        return parts.filter((p) => p.kind && p.i >= ends && p.j <= kinds.length - ends && p.j - p.i <= 0.5 * cell);
      };
      // Whether a line keeps the block's grid lines: at least half of them
      // show the same page or stroke color, or at least a clear dip toward
      // it from the cells on both sides (a 1 px white line between pale
      // cells blurs to a few levels off the page). Give or take a sample.
      // A colorbar, a solid group strip or text beside the cells does not.
      // One grid line is too little to judge by.
      const at = (a, i) => px(a, clamp(s0 + i * step, s0, s1 - 1));
      const off = (rgb) => Math.max(Math.abs(rgb[0] - bg[0]), Math.abs(rgb[1] - bg[1]), Math.abs(rgb[2] - bg[2]));
      const keepsGrid = (a, sep) => {
        if (sep.length < 2) return true;
        const same = sep.filter((p) => {
          const sides = Math.min(off(at(a, p.i - 3)), off(at(a, p.j + 2)));
          for (let i = p.i - 1; i <= p.j; i++) {
            const rgb = at(a, i);
            if (p.kind === 'blank' ? !pale(rgb) || (sides >= 2 * PALE && off(rgb) <= 0.6 * sides) : strong(rgb)) return true;
          }
          return false;
        }).length;
        return same >= 0.5 * sep.length;
      };
      return { px, share, cellRuns, separators, keepsGrid, step, s0, s1 };
    };
    return { bg, ink, faint, pale, strong, tinted, line };
  }

  // Fits a block's edge to a frame around the cells: the edge goes to the
  // frame's middle line, where a grid line between cells would be. A thin
  // frame within 4 lines outside the edge is taken in first; ticks, labels
  // and a colorbar beyond it are not. Frame lines are mostly gray strokes
  // over [s0, s1); a blurred 2 px frame spans 3 to 5 such lines. `edge` is
  // the block's outermost line, `dir` points into the block, `end` is the
  // image size on this axis. Returns the new outermost line.
  function fitFrame(T, horizontal, edge, dir, s0, s1, size, end) {
    const L = T.line(horizontal, s0, s1);
    const frameLine = (a) => a >= 0 && a < end && L.share(a, T.strong) >= FILL;
    for (let o = 1; o <= 4; o++) {
      if (!frameLine(edge - dir * o)) continue;
      let n = 0;
      while (n <= THIN_FRAME && frameLine(edge - dir * (o + n))) n++;
      if (n <= THIN_FRAME) edge -= dir * (o + n - 1);
      break;
    }
    let o = 0;
    while (o <= 3 && !frameLine(edge + dir * o)) o++;
    if (o > 3) return edge;
    let k = 0;
    while (k <= MAX_FRAME && k < size / 3 && frameLine(edge + dir * (o + k))) k++;
    return k > MAX_FRAME ? edge : edge + dir * (o + Math.floor((k - 1) / 2));
  }

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
  function snapBlock(img, box, options = {}) {
    const { margin = 0.25 } = typeof options === 'number' ? { margin: options } : options;
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    if (!(w > 2 && h > 2)) return null;
    const wx0 = clamp(Math.round(box.x0 - w * margin - 10), 0, img.width - 1);
    const wx1 = clamp(Math.round(box.x1 + w * margin + 10), wx0 + 1, img.width);
    const wy0 = clamp(Math.round(box.y0 - h * margin - 10), 0, img.height - 1);
    const wy1 = clamp(Math.round(box.y1 + h * margin + 10), wy0 + 1, img.height);
    const T = lineTools(img, wx0, wy0, wx1, wy1, { x0: box.x0 + 0.2 * w, y0: box.y0 + 0.2 * h, x1: box.x1 - 0.2 * w, y1: box.y1 - 0.2 * h });
    const { ink, faint, pale, strong } = T;

    // Extent along one axis, from the share of ink in a band of the other.
    // `edges` is the block's extent on the other axis once known: grown
    // lines are then read over all of it, not only the band.
    const extent = (horizontal, lo, hi, bandLo, bandHi, inLo, inHi, core = ink, edges = null, inner = []) => {
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
      const frameEnd = (a, dir) => [0, 1, 2, 3].some((k) => fill(a + dir * k, strong) >= FILL);
      const parts = [[keep[0]]];
      for (let i = 1; i < keep.length; i++) {
        let blank = 0;
        for (let a = keep[i - 1][1] + 1; a < keep[i][0]; a++) if (fill(a, pale) < FAINT_FILL) blank++;
        const split = keep[i][0] - keep[i - 1][1] > 2 && blank >= 0.8 * (keep[i][0] - keep[i - 1][1] - 1) && frameEnd(keep[i - 1][1], -1) && frameEnd(keep[i][0], 1);
        if (split) parts.push([keep[i]]);
        else parts[parts.length - 1].push(keep[i]);
      }
      if (parts.length > 1) {
        const c = (inLo + inHi) / 2;
        const span = (p) => [p[0][0], p[p.length - 1][1]];
        const overlap = (p) => Math.min(span(p)[1], inHi) - Math.max(span(p)[0], inLo);
        keep = parts.find((p) => span(p)[0] <= c && c <= span(p)[1]) || parts.reduce((a, p) => (overlap(p) > overlap(a) ? p : a));
      }
      // Grow over pale cells, and past the window when the box cut the block short.
      let from = keep[0][0];
      let to = keep[keep.length - 1][1] + 1;
      const [core0, core1] = [from, to];
      const end = horizontal ? img.width : img.height;
      const inside = (a) => a >= 0 && a < end;
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
      const framed = (a) => !!edges && [edges[0], edges[0] + 1].some((b) => ink(px(a, b))) && [edges[1] - 1, edges[1] - 2].some((b) => ink(px(a, b)));
      const blankLine = (a) => fill(a, pale) < FAINT_FILL;
      // A dark grid line between two rows of pale cells (or a line blurred
      // out of the grid) is crossed when cells that keep the grid follow it;
      // an outer frame has none beyond it.
      const bridge = (a, dir) => {
        let k = 0;
        let gray = false;
        while (k < FRAME_LINE && inside(a + dir * k) && !grows(a + dir * k) && !blankLine(a + dir * k)) [(gray ||= S.share(a + dir * k, strong) >= FILL), k++];
        if (!k || ![0, 1, 2].every((i) => grows(a + dir * (k + i)))) return 0;
        // Without grid lines seen in the cells, a gray line may be their
        // frame: crossed only into lines full of color across the whole
        // span (cells, not a colorbar beside them).
        return bordered || !gray || [0, 1, 2, 3, 4].every((i) => inside(a + dir * (k + i)) && S.share(a + dir * (k + i), faint) >= SPAN_FILL) ? k : 0;
      };
      // A line of cells: enough cell color in long runs, the grid kept; or
      // a line inside the frame that is not the frame itself.
      const grows = (a) => inside(a) && ((S.cellRuns(a) >= FAINT_FILL && S.keepsGrid(a, sep)) || (framed(a) && S.share(a, strong) < FILL));
      // A block that already ends on its frame (a line of ink in one even
      // color, unlike cells) must not jump again, e.g. to a bracket beside
      // the heatmap. (A column of equally pale cells is even too, but no ink.)
      const even = (a) => {
        const lo = [255, 255, 255];
        const hi = [0, 0, 0];
        for (let b = Math.round(bandLo); b < bandHi; b += B.step) px(a, b).forEach((v, i) => ((lo[i] = Math.min(lo[i], v)), (hi[i] = Math.max(hi[i], v))));
        return hi.every((v, i) => v - lo[i] < 40) && fill(a, ink) >= FILL;
      };
      // The edge line or one of the two inside it (an anti-aliased frame).
      const framedEdge = (a, dir) => [0, 1, 2].some((i) => even(a + dir * i));
      // Cells without grid lines that end on a gray frame: nothing beyond
      // the frame is a cell (the halo and a colorbar right next to it are
      // not). With grid lines, keepsGrid tells pale cells from the rest.
      // A gray line inside the cells has cells on both sides.
      const closed = (a, dir) => {
        if (bordered) return false;
        const i = [0, 1, 2, 3].find((i) => S.share(a + dir * i, strong) >= FILL);
        if (i === undefined) return false;
        let o = a + dir * i;
        while (Math.abs(o - a) < 12 && inside(o) && S.share(o, strong) >= 0.5) o -= dir;
        return ![1, 2, 3, 4, 5].every((j) => inside(o - dir * j) && S.share(o - dir * j, faint) >= SPAN_FILL);
      };
      const gap = Math.max(8, Math.round((to - from) * FRAME_GAP));
      const full = (a) => inside(a) && fill(a, faint) >= FILL;
      const frameLine = (a) => !!edges && inside(a) && S.share(a, strong) >= FILL;
      const frame = (a, dir) => {
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
      const widest = Math.min(gap, Math.max(0, ...inner));
      const likeInner = (k) => inner.some((n) => n <= gap && Math.abs(n - k) <= Math.max(1, 0.15 * n));
      const blankRun = (a, dir) => {
        let k = 0;
        while (k <= widest && inside(a + dir * k) && blankLine(a + dir * k)) k++;
        return k;
      };
      // Cells right past a blank run of `blank` lines (after an
      // anti-aliased edge line): at least 4 lines and as many as the run,
      // so an underline of the column labels is not taken for cells. They
      // cover the block's whole span (a colorbar beside the cells is
      // shorter) and keep its grid lines (a solid strip has none).
      const cellLine = (a) => full(a) && (!edges || S.share(a, faint) >= SPAN_FILL) && S.keepsGrid(a, sep);
      const cellsAt = (a, dir, blank) => [0, 1, 2].some((i) => {
        for (let j = 0; j < Math.max(4, blank); j++) if (!cellLine(a + dir * (i + j))) return false;
        return true;
      });
      if (!closed(from, 1)) {
        for (;;) {
          for (let k; from > 0 && (k = grows(from - 1) ? 1 : bridge(from - 1, -1)); ) from -= k;
          // A white gap may start inside the grown lines: JPEG ringing
          // makes it differ from the page by a few levels.
          let f = from;
          while (f < core0 && blankLine(f)) f++;
          const blank = f > 0 ? blankRun(f - 1, -1) : 0;
          if (blank && f - blank < from && likeInner(blank) && cellsAt(f - 1 - blank, -1, blank) && !framedEdge(f, 1)) {
            from = f - blank;
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
          for (let k; to < end && (k = grows(to) ? 1 : bridge(to, 1)); ) to += k;
          let t = to;
          while (t > core1 && blankLine(t - 1)) t--;
          const blank = blankRun(t, 1);
          if (blank && t + blank > to && likeInner(blank) && cellsAt(t + blank, 1, blank) && !framedEdge(t - 1, -1)) {
            to = t + blank;
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

    const find = (core) => {
      const inner = []; // widths of white lines inside the block
      const xsIn = [box.x0 + w * 0.2, box.x1 - w * 0.2];
      const ysIn = [box.y0 + h * 0.2, box.y1 - h * 0.2];
      const mid = (s) => [s[0] + (s[1] - s[0]) * 0.2, s[1] - (s[1] - s[0]) * 0.2];
      let xs = extent(true, wx0, wx1, box.y0 + h * 0.3, box.y1 - h * 0.3, ...xsIn, core, null, inner);
      if (!xs) return null;
      let ys = extent(false, wy0, wy1, ...mid(xs), ...ysIn, core, xs, inner);
      if (!ys) return null;
      // Once more across the rows actually found, so the band avoids labels;
      // and the rows again if the columns changed (the first pass read only
      // a band and may have run into a colorbar).
      const xs2 = extent(true, wx0, wx1, ...mid(ys), ...xsIn, core, ys, inner) || xs;
      if (xs2[0] !== xs[0] || xs2[1] !== xs[1]) ys = extent(false, wy0, wy1, ...mid(xs2), ...ysIn, core, xs2, inner) || ys;
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

  // Edges only, for a box the caller trusts (an LLM read it off the page
  // rulers): each edge moves to the edge of the cells within `tol`
  // (default 3% of the box, at least 4 px), so the box cannot grow into
  // labels, a dendrogram or a colorbar beside the cells; only an edge that
  // lies inside the cells goes further out, to snapBlock's edge.
  // snapBlock's edge is taken where it lies within `tol`; otherwise the
  // edge is refined on its own. A line is full when half of it is off the page; the edge goes to the
  // nearest place where three full lines follow a nearly blank one, then
  // onto the middle of a frame as snapBlock does. An edge with no such
  // change near it (a row of white cells) stays put.
  function snapEdges(img, box, { tol = null } = {}) {
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    if (!(w > 2 && h > 2)) return null;
    const tx = tol ?? Math.max(4, Math.round(0.03 * w));
    const ty = tol ?? Math.max(4, Math.round(0.03 * h));
    const T = lineTools(
      img,
      clamp(Math.round(box.x0 - tx - 10), 0, img.width - 1),
      clamp(Math.round(box.y0 - ty - 10), 0, img.height - 1),
      clamp(Math.round(box.x1 + tx + 10), 1, img.width),
      clamp(Math.round(box.y1 + ty + 10), 1, img.height),
      { x0: box.x0 + 0.2 * w, y0: box.y0 + 0.2 * h, x1: box.x1 - 0.2 * w, y1: box.y1 - 0.2 * h },
    );
    // One edge: `edge` is the box's outermost line, `dir` points inward.
    const fit = (horizontal, edge, dir, s0, s1, t, size) => {
      const end = horizontal ? img.width : img.height;
      const L = T.line(horizontal, s0 + 0.1 * (s1 - s0), s1 - 0.1 * (s1 - s0), 400);
      const ok = (a) => a >= 0 && a < end;
      const full = (a) => ok(a) && L.share(a, T.faint) >= 0.5;
      const blank = (a) => !ok(a) || L.share(a, T.faint) < 0.2;
      edge = clamp(Math.round(edge), 0, end - 1);
      // Places where the cells start (a blank line within 3 lines outside,
      // then 3 full lines), the nearest to the caller's edge wins (not a
      // bracket or labels further out).
      let best = null;
      for (let a = edge - dir * t; dir * (a - (edge + dir * t)) <= 0; a += dir) {
        if (full(a - dir) || ![1, 2, 3].some((i) => blank(a - dir * i)) || ![0, 1, 2].every((i) => full(a + dir * i))) continue;
        if (best === null || Math.abs(a - edge) < Math.abs(best - edge)) best = a;
      }
      return best === null ? edge : fitFrame(T, horizontal, best, dir, s0, s1, size, end);
    };
    // snapBlock's edges where they agree with the box; elsewhere the box
    // is trusted and only refined nearby. An edge inside the cells (its line
    // and the two outside it full of color: the LLM read t1's Average row
    // 12 px short) takes snapBlock's edge further out, up to 30% of the box.
    const snap = snapBlock(img, box) || {};
    const near = (v, e, t) => (Math.abs(v - e) <= t ? v : null);
    const cut = (horizontal, edge, dir, s0, s1, size, v) => {
      if (!Number.isFinite(v) || dir * (edge - v) <= 0 || dir * (edge - v) > 0.3 * size) return null;
      const L = T.line(horizontal, s0 + 0.1 * (s1 - s0), s1 - 0.1 * (s1 - s0), 400);
      return [0, 1, 2].every((i) => L.share(Math.round(edge) - dir * i, T.faint) >= 0.5) ? v : null;
    };
    const x0 = near(snap.x0, box.x0, tx) ?? cut(true, box.x0, 1, box.y0, box.y1, w, snap.x0) ?? fit(true, box.x0, 1, box.y0, box.y1, tx, w);
    const x1 = near(snap.x1, box.x1, tx) ?? cut(true, box.x1 - 1, -1, box.y0, box.y1, w, snap.x1) ?? fit(true, box.x1 - 1, -1, box.y0, box.y1, tx, w) + 1;
    const y0 = near(snap.y0, box.y0, ty) ?? cut(false, box.y0, 1, x0, x1, h, snap.y0) ?? fit(false, box.y0, 1, x0, x1, ty, h);
    const y1 = near(snap.y1, box.y1, ty) ?? cut(false, box.y1 - 1, -1, x0, x1, h, snap.y1) ?? fit(false, box.y1 - 1, -1, x0, x1, ty, h) + 1;
    return { x0, y0, x1, y1 };
  }

  // Connected components (8-neighbour) of `mask(x, y)` inside a window, as
  // bounding boxes with pixel counts.
  function components(x0, y0, x1, y1, mask) {
    const W = x1 - x0;
    const H = y1 - y0;
    const on = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) on[y * W + x] = mask(x0 + x, y0 + y) ? 1 : 0;
    const out = [];
    const stack = [];
    for (let i = 0; i < on.length; i++) {
      if (on[i] !== 1) continue;
      on[i] = 2;
      stack.push(i);
      const c = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, n: 0 };
      while (stack.length) {
        const j = stack.pop();
        const x = j % W;
        const y = (j - x) / W;
        c.n++;
        c.x0 = Math.min(c.x0, x);
        c.x1 = Math.max(c.x1, x);
        c.y0 = Math.min(c.y0, y);
        c.y1 = Math.max(c.y1, y);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const k = ny * W + nx;
            if (on[k] === 1) {
              on[k] = 2;
              stack.push(k);
            }
          }
        }
      }
      out.push({ x0: c.x0 + x0, y0: c.y0 + y0, x1: c.x1 + x0 + 1, y1: c.y1 + y0 + 1, n: c.n });
    }
    return out;
  }

  // Colorbars. A colorbar is a strip at least BAR_THICK px thick and 3 times
  // as long, whose color changes along it (smoothly or in bins) and not
  // across it. Its pixels are found by their difference from the page, not
  // by chroma alone: a diverging bar has a white middle and a pale bar a
  // near-white end, which once split a bar in two or cut it short.
  const BAR_THICK = 4;
  const BAR_CHROMA = 10; // least chroma of a colorbar pixel off its white parts
  const BAR_STEP = 15; // least change over 3 lines at a bin edge

  // Pixel tests for colorbars on the page around `region`.
  function barTools(img, region) {
    const x0 = clamp(Math.floor(region.x0), 0, img.width - 1);
    const y0 = clamp(Math.floor(region.y0), 0, img.height - 1);
    const x1 = clamp(Math.ceil(region.x1), x0 + 1, img.width);
    const y1 = clamp(Math.ceil(region.y1), y0 + 1, img.height);
    const bg = background(img, x0, y0, x1, y1);
    const pale = differs(bg, Math.max(noiseTol(img, x0, y0, x1, y1, bg), PALE));
    const strong = stroke(bg);
    const chroma = (rgb) => Math.max(...rgb) - Math.min(...rgb);
    // Tinted, and not a near-black outline (a dark red frame is 20 levels
    // of chroma; a gray-blue end of a colormap is lighter).
    const colored = (rgb) => pale(rgb) && chroma(rgb) >= BAR_CHROMA && !(strong(rgb) && mean(rgb) < 100);
    return { x0, y0, x1, y1, bg, pale, strong, colored };
  }

  // The strip that a seed box (a colored component, or a rough box around a
  // bar) lies on: its cross-section [c0, c1) where most of the seed's lines
  // are colored, then its ends along the axis. The ends are followed past
  // the seed over colored lines, a dark end (4 or more gray lines, such as
  // magma's black), white lines inside a frame (both sides of the strip are
  // gray strokes) and a white gap no longer than the strip is thick with
  // the strip going on beyond it (the white middle of a diverging bar). A
  // frame's end cap is left out. Returns {x0, y0, x1, y1, vertical} or null.
  function followStrip(img, B, seed, vertical) {
    const W = img.width;
    const H = img.height;
    const px = (u, c) => (vertical ? readPixel(img, c, u) : readPixel(img, u, c));
    const [u0, u1, k0, k1] = vertical ? [seed.y0, seed.y1, seed.x0, seed.x1] : [seed.x0, seed.x1, seed.y0, seed.y1];
    const uEnd = vertical ? H : W;
    const cEnd = vertical ? W : H;
    // Cross-section: lines across the middle half of the seed that are colored.
    const across = (c) => {
      let n = 0;
      let t = 0;
      const a = u0 + 0.25 * (u1 - u0);
      const b = u1 - 0.25 * (u1 - u0);
      for (let u = a; u < b; u += Math.max(1, (b - a) / 40), t++) if (B.colored(px(Math.round(u), c))) n++;
      return t ? n / t : 0;
    };
    let c0 = Math.round(k0);
    let c1 = Math.round(k1);
    const mid = Math.round((c0 + c1) / 2);
    if (across(mid) < 0.5) {
      // A rough box: the best line near its middle.
      let best = -1;
      for (let c = c0; c < c1; c++) if (best < 0 || across(c) > across(best)) best = c;
      if (best < 0 || across(best) < 0.5) return null;
      c0 = c1 = best;
      c1++;
    } else [c0, c1] = [mid, mid + 1];
    while (c0 > 0 && across(c0 - 1) >= 0.5) c0--;
    while (c1 < cEnd && across(c1) >= 0.5) c1++;
    const thick = c1 - c0;
    if (thick < BAR_THICK) return null;
    // Shares of one line across the strip (its outer pixels left out).
    const m = thick > 6 ? 1 : 0;
    const stats = (u) => {
      let col = 0;
      let page = 0;
      let dark = 0;
      let mid = 0;
      const q = Math.floor(thick / 4);
      for (let c = c0 + m; c < c1 - m; c++) {
        const rgb = px(u, c);
        if (B.colored(rgb)) col++;
        else if (!B.pale(rgb)) page++;
        else if (B.strong(rgb)) dark++;
        if (c >= c0 + q && c < c1 - q && B.pale(rgb)) mid++;
      }
      const t = c1 - c0 - 2 * m;
      // `mid`: off the page across the middle half (a pale gray middle
      // of a diverging bar blurs into the page at its sides).
      return { col: col / t, page: page / t, dark: dark / t, mid: mid / (c1 - c0 - 2 * q) };
    };
    // A frame line on both sides: gray and off the page (a 1 px light gray
    // outline blurs to 40 levels).
    const line = (rgb) => B.pale(rgb) && Math.max(...rgb) - Math.min(...rgb) < NEUTRAL;
    const sideFramed = (u) => [-1, 0, 1, 2, 3].some((i) => c0 - i >= 0 && line(px(u, c0 - i))) && [-2, -1, 0, 1, 2].some((i) => c1 + i < cEnd && line(px(u, c1 + i)));
    const inside = (u) => u >= 0 && u < uEnd;
    const follow = (start, dir) => {
      let u = start;
      for (;;) {
        const v = u + dir;
        if (!inside(v)) return u;
        const s = stats(v);
        if (s.col >= FILL || (s.mid >= FILL && !(s.dark >= FILL))) {
          u = v;
          continue;
        }
        if (s.dark >= FILL) {
          let k = 0;
          while (k < BAR_THICK && inside(v + dir * k) && stats(v + dir * k).dark >= FILL) k++;
          if (k >= BAR_THICK) {
            u = v + dir * (k - 1);
            continue;
          }
          return u; // a frame's end cap
        }
        if (s.dark < 0.5 && sideFramed(v)) {
          u = v;
          continue;
        }
        // A white gap, then more of the strip.
        let g = 1;
        while (g <= thick && inside(v + dir * g) && stats(v + dir * g).page >= FILL) g++;
        // Past the gap the strip goes on and turns colored within its
        // thickness (not a gray legend box below the bar).
        const at = (i) => inside(v + dir * (g + i)) && stats(v + dir * (g + i));
        // (after up to 2 blurred lines)
        let i = [0, 1, 2].find((i) => at(i) && at(i).mid >= FILL) ?? 0;
        const goesOn = [0, 1, 2].every((k) => at(i + k) && at(i + k).mid >= FILL);
        while (goesOn && i < thick && at(i) && at(i).mid >= FILL && at(i).col < FILL) i++;
        if (g <= thick && goesOn && at(i) && at(i).col >= FILL) {
          u = v + dir * g;
          continue;
        }
        return u;
      }
    };
    // Start on the colored line nearest the seed's middle.
    let start = Math.round((u0 + u1) / 2);
    for (let d = 0; d < (u1 - u0) / 2; d++) {
      if (stats(start + d).col >= FILL) [(start += d), (d = Infinity)];
      else if (stats(start - d).col >= FILL) [(start -= d), (d = Infinity)];
    }
    const a = follow(start, -1);
    const b = follow(start, 1) + 1;
    const len = b - a;
    if (len < 3 * thick) return null;
    return vertical ? { x0: c0, y0: a, x1: c1, y1: b, vertical } : { x0: a, y0: c0, x1: b, y1: c1, vertical };
  }

  // What the colors along a strip look like: the median color of each
  // line across it. Gradual change along it makes a smooth colorbar, 5 or
  // more flat bins a binned one, 4 or fewer a categorical strip (a group
  // legend), unless the strip changes across (text, a heatmap block): then
  // it is not a colorbar at all (null).
  function stripKind(img, bar) {
    const v = bar.vertical;
    const [a, b, c0, c1] = v ? [bar.y0, bar.y1, bar.x0, bar.x1] : [bar.x0, bar.x1, bar.y0, bar.y1];
    const m = c1 - c0 > 6 ? 1 : 0;
    const px = (u, c) => (v ? readPixel(img, c, u) : readPixel(img, u, c));
    // Each line's median color, and whether most of the line is near it
    // (text written over a bar, as t9's "z-score", covers less than half).
    const means = [];
    let uneven = 0;
    for (let u = a; u < b; u++) {
      const line = [];
      for (let c = c0 + m; c < c1 - m; c++) line.push(px(u, c));
      const med = [0, 1, 2].map((i) => median(line.map((rgb) => rgb[i])));
      means.push(med);
      const near = line.filter((rgb) => rgb.every((x, i) => Math.abs(x - med[i]) <= 30)).length;
      if (near < 0.6 * line.length) uneven++;
    }
    if (uneven > 0.2 * means.length) return null;
    // Steps over 3 lines larger than BAR_STEP are bin edges (a blurred edge
    // spans a few lines).
    const diff = (p, q) => Math.max(...p.map((x, k) => Math.abs(x - q[k])));
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
    const colors = [];
    const stretches = [];
    let flat = 0;
    let gradual = 0;
    let last = null;
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
    const apart = (a, b) => {
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

  const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

  // Every colorbar candidate in `region` (the whole page by default), with
  // `exclude` boxes (heatmap cells) left out: [{x0, y0, x1, y1, vertical,
  // kind}] with kind 'smooth', 'binned' or 'categorical' (a group strip; a
  // bar of 4 bins or fewer looks the same), longest first. Gray-only
  // colormaps are missed, and a white end without a frame is cut off.
  function findColorbars(img, { region = null, exclude = [] } = {}) {
    region ??= { x0: 0, y0: 0, x1: img.width, y1: img.height };
    const B = barTools(img, region);
    const out = [];
    const grown = exclude.map((b) => ({ x0: b.x0 - 2, y0: b.y0 - 2, x1: b.x1 + 2, y1: b.y1 + 2 }));
    const excluded = (x, y) => grown.some((b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1);
    const comps = components(B.x0, B.y0, B.x1, B.y1, (x, y) => B.colored(readPixel(img, x, y)) && !excluded(x, y));
    // Big pieces first, so the halves of a diverging bar join the first one's strip.
    comps.sort((a, b) => b.n - a.n);
    for (const c of comps) {
      const w = c.x1 - c.x0;
      const h = c.y1 - c.y0;
      if (Math.min(w, h) < BAR_THICK || Math.max(w, h) < 1.5 * Math.min(w, h) || c.n < 0.5 * w * h) continue;
      if (out.some((b) => overlaps(b, c))) continue;
      const bar = followStrip(img, B, c, h >= w);
      if (!bar || out.some((b) => overlaps(b, bar)) || grown.some((b) => overlaps(b, bar))) continue;
      const kind = stripKind(img, bar);
      if (kind) out.push({ ...bar, kind });
    }
    const len = (b) => (b.vertical ? b.y1 - b.y0 : b.x1 - b.x0);
    return out.sort((a, b) => len(b) - len(a));
  }

  // The colored strip of a colorbar from a rough box around it (a decision
  // model's answer, or an LLM's): the strip through the box, followed to
  // its ends as findColorbars does, without its frame. Null when the box
  // holds no strip.
  function snapStrip(img, box) {
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    if (!(w > 2 && h > 2)) return null;
    const B = barTools(img, { x0: box.x0 - w * 0.25 - 10, y0: box.y0 - h * 0.25 - 10, x1: box.x1 + w * 0.25 + 10, y1: box.y1 + h * 0.25 + 10 });
    const bar = followStrip(img, B, box, h >= w) || followStrip(img, B, box, h < w);
    return bar && { x0: bar.x0, y0: bar.y0, x1: bar.x1, y1: bar.y1 };
  }

  // A colorbar strip inside `region`, found without a decision model's box:
  // the longest smooth or binned strip found by findColorbars (a
  // categorical one only when there is nothing else). `exclude`: heatmap
  // cells to leave out. A fallback for when a box answer for the colorbar is off.
  function findStrip(img, region, { exclude = [] } = {}) {
    if (region.x1 - region.x0 < 4 || region.y1 - region.y0 < 4) return null;
    const bars = findColorbars(img, { region, exclude });
    const best = bars.find((b) => b.kind !== 'categorical') || bars[0];
    return best ? { x0: best.x0, y0: best.y0, x1: best.x1, y1: best.y1 } : null;
  }

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
  function findTickLabels(img, bar, { exclude = [] } = {}) {
    const vertical = bar.y1 - bar.y0 >= bar.x1 - bar.x0;
    const len = vertical ? bar.y1 - bar.y0 : bar.x1 - bar.x0;
    const thick = vertical ? bar.x1 - bar.x0 : bar.y1 - bar.y0;
    const reach = vertical ? Math.max(70, 6 * thick) : Math.max(40, 3 * thick);
    // The window runs a quarter of the strip past its ends, to see a row
    // of labels go on past them.
    const pad = Math.max(12, Math.round(len * 0.25));
    const [b0, b1] = vertical ? [bar.y0, bar.y1] : [bar.x0, bar.x1];
    const sides = vertical ? ['right', 'left'] : ['below', 'above'];
    const excluded = (x, y) => exclude.some((b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1);
    // Tick marks drawn inside the strip on one side: short strokes in its
    // outer 4 lines, much darker than its middle (frame caps aside).
    const innerTicks = (side) => {
      const out = [];
      const far = side === 'right' || side === 'below';
      const e = far ? (vertical ? bar.x1 : bar.y1) - 1 : vertical ? bar.x0 : bar.y0;
      const c = Math.round(vertical ? (bar.x0 + bar.x1) / 2 : (bar.y0 + bar.y1) / 2);
      const px = (u, k) => (vertical ? readPixel(img, k, u) : readPixel(img, u, k));
      let run = [];
      for (let u = b0; u <= b1; u++) {
        const m = mean(px(u, c));
        const hit = u > b0 + 3 && u < b1 - 3 && [1, 2, 3].some((i) => mean(px(u, e + (far ? -i : i))) < m - STRONG);
        if (hit) run.push(u);
        else if (run.length) [run.length <= 4 && out.push((run[0] + run[run.length - 1]) / 2), (run = [])];
      }
      return out;
    };
    let best = { side: sides[0], marks: [], score: 0 };
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
      const frame = (c) => ({
        ...c,
        u0: vertical ? c.y0 : c.x0,
        u1: vertical ? c.y1 : c.x1,
        d0: far ? (vertical ? c.x0 : c.y0) - edge : edge - (vertical ? c.x1 : c.y1),
        d1: far ? (vertical ? c.x1 : c.y1) - edge : edge - (vertical ? c.x0 : c.y0),
        size: vertical ? c.y1 - c.y0 : c.x1 - c.x0,
        across: vertical ? c.x1 - c.x0 : c.y1 - c.y0,
      });
      // Text is gray strokes; a solid blob (another colorbar's end) is not.
      const gray = (c) => {
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
      for (let i = chars.length - 1; i >= 0; i--) if (chars[i].size >= 2 * charH && chars[i].across <= 0.5 * charH) chars.splice(i, 1);
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
      const fits = (l, c) => (vertical ? Math.max(l.u1, c.u1) - Math.min(l.u0, c.u0) : Math.max(l.d1, c.d1) - Math.min(l.d0, c.d0)) <= lineH;
      for (const c of chars) {
        // (an exponent sits a little higher than its number)
        const g = vertical
          ? labels.find((l) => c.u0 < l.u1 + 0.2 * charH && l.u0 < c.u1 + 0.2 * charH && c.d0 <= l.d1 + 0.5 * charH && l.d0 <= c.d1 + 0.5 * charH && fits(l, c))
          : labels.find((l) => c.u0 <= l.u1 + Math.max(2, 0.6 * charH) && c.d0 < l.d1 && l.d0 < c.d1 && fits(l, c));
        if (g) {
          [g.u0, g.u1, g.d0, g.d1] = [Math.min(g.u0, c.u0), Math.max(g.u1, c.u1), Math.min(g.d0, c.d0), Math.max(g.d1, c.d1)];
          g.box = { x0: Math.min(g.box.x0, c.x0), y0: Math.min(g.box.y0, c.y0), x1: Math.max(g.box.x1, c.x1), y1: Math.max(g.box.y1, c.y1) };
          g.n++;
        } else labels.push({ u0: c.u0, u1: c.u1, d0: c.d0, d1: c.d1, n: 1, box: { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 } });
      }
      // Pieces of one label that met in the wrong order ("55." and "60").
      for (let i = 0; i < labels.length; i++)
        for (let j = i + 1; j < labels.length; j++) {
          const [a, c] = [labels[i], labels[j]];
          const join = vertical
            ? c.u0 < a.u1 + 0.2 * charH && a.u0 < c.u1 + 0.2 * charH && c.d0 <= a.d1 + 0.5 * charH && a.d0 <= c.d1 + 0.5 * charH
            : c.u0 <= a.u1 + Math.max(2, 0.6 * charH) && a.u0 <= c.u1 + Math.max(2, 0.6 * charH) && c.d0 < a.d1 && a.d0 < c.d1;
          if (!join || !fits(a, c)) continue;
          [a.u0, a.u1, a.d0, a.d1] = [Math.min(a.u0, c.u0), Math.max(a.u1, c.u1), Math.min(a.d0, c.d0), Math.max(a.d1, c.d1)];
          a.box = { x0: Math.min(a.box.x0, c.box.x0), y0: Math.min(a.box.y0, c.box.y0), x1: Math.max(a.box.x1, c.box.x1), y1: Math.max(a.box.y1, c.box.y1) };
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
        const glyph = (l) => l.n <= 2;
        for (let i = 0; i < labels.length; ) {
          let j = i + 1;
          while (j < labels.length && glyph(labels[j]) && glyph(labels[j - 1]) && labels[j].u0 - labels[j - 1].u1 < 0.35 * charH && Math.abs(labels[j].d0 - labels[j - 1].d0) < charH) j++;
          if (j - i >= 3) for (let k = i; k < j; k++) title.add(labels[k]);
          i = j;
        }
      }
      // Specks smaller than half a character are not labels.
      let row = labels.filter((l) => !title.has(l) && Math.max(l.box.x1 - l.box.x0, l.box.y1 - l.box.y0) >= 0.5 * charH);
      // Along the strip, give or take a quarter glyph.
      const tol = Math.max(3, 0.25 * charH);
      const mid = (l) => (l.u0 + l.u1) / 2;
      const along = (l) => mid(l) >= b0 - tol && mid(l) <= b1 + tol;
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
      const score = (on.length >= 2 ? on.length : 0.5) * even * close * (on.length / (on.length + beyond)) * (spread < 0.5 ? 0.5 : 1) + onTicks;
      if (score > best.score) best = { side, score, on, row, charH };
    }
    if (!best.on) return { side: best.side, marks: [], score: 0 };
    return tickMarks(img, bar, best, { vertical, len, b0, b1 });
  }

  // Positions of the steps between a binned colorbar's bins along it
  // (line medians that change by more than BAR_STEP over 3 lines). Two
  // steps within 12 px of each other are the sides of a line drawn across
  // the bar (a tick mark), not a step: both are left out.
  function binEdges(img, bar, vertical) {
    const [a, b, c0, c1] = vertical ? [bar.y0, bar.y1, bar.x0, bar.x1] : [bar.x0, bar.x1, bar.y0, bar.y1];
    const m = c1 - c0 > 6 ? 1 : 0;
    const means = [];
    for (let u = a; u < b; u++) {
      const line = [];
      for (let c = c0 + m; c < c1 - m; c++) line.push(vertical ? readPixel(img, c, u) : readPixel(img, u, c));
      means.push([0, 1, 2].map((i) => median(line.map((rgb) => rgb[i]))));
    }
    const diff = (p, q) => Math.max(...p.map((x, k) => Math.abs(x - q[k])));
    const out = [];
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
    return out.filter((e, i) => !(Math.abs(e - (out[i - 1] ?? -Infinity)) < 12 || Math.abs((out[i + 1] ?? Infinity) - e) < 12));
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
  function tickMarks(img, bar, best, { vertical, len, b0, b1 }) {
    const { charH } = best;
    const mid = (l) => (l.u0 + l.u1) / 2;
    let on = best.on;
    const tol = Math.max(6, 0.6 * charH);
    const inner = binEdges(img, bar, vertical).filter((e) => e > b0 + tol && e < b1 - tol);
    const onStep = (l) => [b0, b1, ...inner].some((e) => Math.abs(e - mid(l)) <= tol);
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
      const bg = background(img, Math.max(0, bar.x0 - 20), Math.max(0, bar.y0 - 20), Math.min(img.width, bar.x1 + 20), Math.min(img.height, bar.y1 + 20));
      const pale = differs(bg, 4);
      const c = Math.round(vertical ? (bar.x0 + bar.x1) / 2 : (bar.y0 + bar.y1) / 2);
      const offPage = (from, to) => {
        let n = 0;
        let t = 0;
        for (let u = Math.round(from); u < to; u++, t++) if (pale(vertical ? readPixel(img, c, u) : readPixel(img, u, c))) n++;
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
    const marks = on.map((l, i) => {
      const odd = on.length >= 3 && (sizes[i] > 3 * typical || l.n > 2 * glyphs + 2);
      return { at: vertical ? { x: m, y: mid(l) } : { x: mid(l), y: m }, box: l.box, ...(odd ? { note: 'larger than the other labels (a title, or two labels joined?)' } : {}) };
    });
    const out = { side: best.side, marks, score: best.score };
    if (extended) out.bar = vertical ? { ...bar, y0: extended.b0 ?? bar.y0, y1: extended.b1 ?? bar.y1 } : { ...bar, x0: extended.b0 ?? bar.x0, x1: extended.b1 ?? bar.x1 };
    return out;
  }

  // How far the labels next to a block of cells reach on one side ('left',
  // 'right', 'above', 'below'): walk away from the block until `gap` blank
  // lines in a row (within the block's span), at most `reach` pixels. Used
  // to crop a heatmap with its labels but without the next figure panel.
  // The gap grows with the block (2% of its size, at least 15 px): on a
  // 1770 px wide screenshot the row labels sat 24 px left of their legend
  // boxes and were cut off.
  function labelReach(img, cells, side, reach, gap = null) {
    const horizontal = side === 'left' || side === 'right';
    gap ??= Math.max(15, Math.round(0.02 * (horizontal ? cells.x1 - cells.x0 : cells.y1 - cells.y0)));
    const dir = side === 'left' || side === 'above' ? -1 : 1;
    const start = side === 'left' ? cells.x0 - 1 : side === 'right' ? cells.x1 : side === 'above' ? cells.y0 - 1 : cells.y1;
    const [s0, s1] = horizontal ? [cells.y0, cells.y1] : [cells.x0, cells.x1];
    const end = horizontal ? img.width : img.height;
    // Background from the strip walked over, not the cells.
    const [a0, a1] = dir < 0 ? [start - reach, start] : [start, start + reach];
    const bx0 = clamp(Math.round(horizontal ? a0 : s0), 0, img.width - 1);
    const by0 = clamp(Math.round(horizontal ? s0 : a0), 0, img.height - 1);
    const bx1 = clamp(Math.round(horizontal ? a1 : s1), bx0 + 1, img.width);
    const by1 = clamp(Math.round(horizontal ? s1 : a1), by0 + 1, img.height);
    const ink = differs(background(img, bx0, by0, bx1, by1), INK);
    const step = Math.max(1, Math.floor((s1 - s0) / 150));
    const blank = (a) => {
      for (let b = Math.round(s0); b < s1; b += step) if (ink(horizontal ? readPixel(img, a, b) : readPixel(img, b, a))) return false;
      return true;
    };
    let last = start;
    let empty = 0;
    for (let i = 1, a = start + dir; i <= reach && a >= 0 && a < end; i++, a += dir) {
      if (blank(a)) {
        if (++empty >= gap) break;
      } else {
        empty = 0;
        last = a;
      }
    }
    return last;
  }

  Object.assign(CM, { snapBlock, snapEdges, snapStrip, findStrip, findColorbars, findTickLabels, labelReach, binEdges });
})((globalThis.Colormeris ??= {}));

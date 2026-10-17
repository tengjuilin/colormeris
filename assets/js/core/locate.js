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
  // this share of it differs from the page by more than the page's noise.
  const FAINT_FILL = 0.1;
  // Furthest a frame line may sit past the block, as a share of its size.
  const FRAME_GAP = 0.06;
  const FRAME_LINE = 4;
  const TEXT = 90; // the same for dark text

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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
  // that are near the background, doubled, and at least 4 levels.
  function noiseTol(img, x0, y0, x1, y1, bg) {
    const dev = [];
    const add = (x, y) => {
      const rgb = readPixel(img, x, y);
      const d = Math.max(Math.abs(rgb[0] - bg[0]), Math.abs(rgb[1] - bg[1]), Math.abs(rgb[2] - bg[2]));
      if (d < 24) dev.push(d);
    };
    for (let x = x0; x < x1; x += 2) [add(x, y0), add(x, y1 - 1)];
    for (let y = y0; y < y1; y += 2) [add(x0, y), add(x1 - 1, y)];
    dev.sort((a, b) => a - b);
    return Math.max(4, 2 * (dev[Math.floor(0.9 * (dev.length - 1))] || 0));
  }

  const differs = (bg, tol) => (rgb) => Math.max(Math.abs(rgb[0] - bg[0]), Math.abs(rgb[1] - bg[1]), Math.abs(rgb[2] - bg[2])) > tol;

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

  // The filled block inside a rough box: the outermost runs of mostly-ink
  // columns (then rows) that reach into the middle 60% of the box. Text
  // labels never fill 75% of a band, and white lines between cells are
  // bridged because the runs on both sides reach the middle. Then the block
  // grows over lines whose cells are nearly the page color (a colormap that
  // starts at white, as Blues does): it stops at the first line where almost
  // nothing differs from the page, the gap before labels or a neighbour. A
  // whole edge row or column of pure-white cells cannot be seen and is
  // lost. Returns the snapped box, or null when no block is found.
  function snapBlock(img, box, margin = 0.25) {
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    if (!(w > 2 && h > 2)) return null;
    const wx0 = clamp(Math.round(box.x0 - w * margin - 10), 0, img.width - 1);
    const wx1 = clamp(Math.round(box.x1 + w * margin + 10), wx0 + 1, img.width);
    const wy0 = clamp(Math.round(box.y0 - h * margin - 10), 0, img.height - 1);
    const wy1 = clamp(Math.round(box.y1 + h * margin + 10), wy0 + 1, img.height);
    const bg = background(img, wx0, wy0, wx1, wy1);
    const ink = differs(bg, INK);
    const faint = differs(bg, noiseTol(img, wx0, wy0, wx1, wy1, bg));

    // Extent along one axis, from the share of ink in a band of the other.
    const extent = (horizontal, lo, hi, bandLo, bandHi, inLo, inHi, core = ink, edges = null, inner = []) => {
      const b0 = Math.round(bandLo);
      const b1 = Math.max(b0 + 1, Math.round(bandHi));
      const step = Math.max(1, Math.floor((b1 - b0) / 200));
      const fill = (a, test = ink) => {
        let n = 0;
        let t = 0;
        for (let b = b0; b < b1; b += step, t++) if (test(horizontal ? readPixel(img, a, b) : readPixel(img, b, a))) n++;
        return n / t;
      };
      const profile = [];
      for (let a = lo; a < hi; a++) profile.push(fill(a, core));
      const keep = runs(profile, lo).filter(([a, b]) => b >= inLo && a <= inHi);
      if (!keep.length) return null;
      // Grow over pale cells, and past the window when the box cut the block short.
      let from = keep[0][0];
      let to = keep[keep.length - 1][1] + 1;
      const end = horizontal ? img.width : img.height;
      // A frame drawn around the cells is crossed too: a whole edge row of
      // near-white cells, then a thin full line (at most FRAME_LINE px; a
      // colorbar or a neighbour's cells are thicker), within FRAME_GAP.
      // A line of pure-white cells inside a frame still touches the frame's
      // sides (`edges`: the block's ends on the other axis).
      const px = (a, b) => (horizontal ? readPixel(img, a, b) : readPixel(img, b, a));
      const framed = (a) => !!edges && [edges[0], edges[0] + 1].some((b) => ink(px(a, b))) && [edges[1] - 1, edges[1] - 2].some((b) => ink(px(a, b)));
      const grows = (a) => fill(a, faint) >= FAINT_FILL || framed(a);
      // A block that already ends on its frame (a line of ink in one even
      // color, unlike cells) must not jump again, e.g. to a bracket beside
      // the heatmap. (A column of equally pale cells is even too, but no ink.)
      const even = (a) => {
        const lo = [255, 255, 255];
        const hi = [0, 0, 0];
        for (let b = b0; b < b1; b += step) px(a, b).forEach((v, i) => ((lo[i] = Math.min(lo[i], v)), (hi[i] = Math.max(hi[i], v))));
        return hi.every((v, i) => v - lo[i] < 40) && fill(a, ink) >= FILL;
      };
      // The edge line or one of the two inside it (an anti-aliased frame).
      const framedEdge = (a, dir) => [0, 1, 2].some((i) => even(a + dir * i));
      const gap = Math.max(8, Math.round((to - from) * FRAME_GAP));
      const full = (a) => a >= 0 && a < end && fill(a, faint) >= FILL;
      const frame = (a, dir) => {
        let n = 0;
        while (n <= FRAME_LINE && full(a + dir * n)) n++;
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
        if (a < to && fill(a, faint) < FAINT_FILL) n++;
        else if (n) [inner.push(n), (n = 0)];
      }
      const widest = Math.min(gap, Math.max(0, ...inner));
      const likeInner = (k) => inner.some((n) => n <= gap && Math.abs(n - k) <= Math.max(1, 0.15 * n));
      const blankRun = (a, dir) => {
        let k = 0;
        while (k <= widest && a + dir * k >= 0 && a + dir * k < end && !grows(a + dir * k)) k++;
        return k;
      };
      // Full cells right past a blank run of `blank` lines (after an
      // anti-aliased edge line): at least 4 full lines and as many as the
      // run, so an underline of the column labels is not taken for cells.
      const cellsAt = (a, dir, blank) => [0, 1, 2].some((i) => {
        for (let j = 0; j < Math.max(4, blank); j++) if (!full(a + dir * (i + j))) return false;
        return true;
      });
      for (;;) {
        while (from > 0 && grows(from - 1)) from--;
        const blank = from > 0 ? blankRun(from - 1, -1) : 0;
        if (blank && likeInner(blank) && cellsAt(from - 1 - blank, -1, blank) && !framedEdge(from, 1)) {
          from -= blank;
          continue;
        }
        let k = 1;
        while (k <= gap && from - k >= 0 && !full(from - k)) k++;
        const n = k <= gap && !framedEdge(from, 1) ? frame(from - k, -1) : 0;
        if (!n) break;
        from -= k + n - 1;
      }
      for (;;) {
        while (to < end && grows(to)) to++;
        const blank = blankRun(to, 1);
        if (blank && likeInner(blank) && cellsAt(to + blank, 1, blank) && !framedEdge(to - 1, -1)) {
          to += blank;
          continue;
        }
        let k = 0;
        while (k < gap && !full(to + k) && to + k < end) k++;
        const n = k < gap && !framedEdge(to - 1, -1) ? frame(to + k, 1) : 0;
        if (!n) break;
        to += k + n;
      }
      return [from, to];
    };

    const find = (core) => {
      const inner = []; // widths of white lines inside the block
      let xs = extent(true, wx0, wx1, box.y0 + h * 0.3, box.y1 - h * 0.3, box.x0 + w * 0.2, box.x1 - w * 0.2, core, null, inner);
      if (!xs) return null;
      const ys = extent(false, wy0, wy1, xs[0] + (xs[1] - xs[0]) * 0.2, xs[1] - (xs[1] - xs[0]) * 0.2, box.y0 + h * 0.2, box.y1 - h * 0.2, core, xs, inner);
      if (!ys) return null;
      // Once more across the rows actually found, so the band avoids labels.
      xs = extent(true, wx0, wx1, ys[0] + (ys[1] - ys[0]) * 0.2, ys[1] - (ys[1] - ys[0]) * 0.2, box.x0 + w * 0.2, box.x1 - w * 0.2, core, ys, inner) || xs;
      return { x0: xs[0], y0: ys[0], x1: xs[1], y1: ys[1] };
    };
    // A diverging map around white (most cells pale) has no line that is 75%
    // strong ink; then the core is found from anything off the page color.
    return find(ink) || find(faint);
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

  const median = (v) => {
    const s = [...v].sort((a, b) => a - b);
    return s.length ? s[s.length >> 1] : 0;
  };

  // A colorbar strip inside `region`, found without a decision model's box:
  // the largest colored (chroma > 30) connected block that is at least 3
  // times as long as it is thick and 4 px thick, snapped with snapBlock so
  // its pale or gray parts are taken in. Gray-only colormaps are missed.
  // A fallback for when a box answer for the colorbar is off.
  function findStrip(img, region) {
    const x0 = Math.max(0, Math.floor(region.x0));
    const y0 = Math.max(0, Math.floor(region.y0));
    const x1 = Math.min(img.width, Math.ceil(region.x1));
    const y1 = Math.min(img.height, Math.ceil(region.y1));
    if (x1 - x0 < 4 || y1 - y0 < 4) return null;
    const colored = (x, y) => {
      const [r, g, b] = readPixel(img, x, y);
      return Math.max(r, g, b) - Math.min(r, g, b) > 30;
    };
    let best = null;
    for (const c of components(x0, y0, x1, y1, colored)) {
      const w = c.x1 - c.x0;
      const h = c.y1 - c.y0;
      if (Math.min(w, h) < 4 || Math.max(w, h) < 3 * Math.min(w, h) || c.n < 0.6 * w * h) continue;
      if (!best || c.n > best.n) best = c;
    }
    return best && (snapBlock(img, best, 0.1) || { x0: best.x0, y0: best.y0, x1: best.x1, y1: best.y1 });
  }

  // Tick labels beside a colorbar strip `bar` (a box around the colored
  // strip). Dark text is split into characters, characters are grouped into
  // labels along the bar, and the side of the bar with more labels wins.
  // Tick marks (short strokes touching the strip) and a title further out are
  // left out. Returns {side, marks: [{at, box}]}: `at` is the label's middle
  // projected onto the strip's centre line, in reading order (top to bottom
  // for a vertical bar, left to right for a horizontal one).
  function findTickLabels(img, bar) {
    const vertical = bar.y1 - bar.y0 >= bar.x1 - bar.x0;
    const len = vertical ? bar.y1 - bar.y0 : bar.x1 - bar.x0;
    const thick = vertical ? bar.x1 - bar.x0 : bar.y1 - bar.y0;
    const reach = vertical ? Math.max(70, 6 * thick) : Math.max(40, 3 * thick);
    const pad = Math.max(12, Math.round(len * 0.06));
    const sides = vertical ? ['right', 'left'] : ['below', 'above'];
    let best = { side: sides[0], marks: [] };
    for (const side of sides) {
      // Window beside the strip: `across` runs away from the strip, `along` with it.
      const far = side === 'right' || side === 'below';
      const a0 = vertical ? bar.y0 - pad : bar.x0 - pad;
      const a1 = vertical ? bar.y1 + pad : bar.x1 + pad;
      const edge = far ? (vertical ? bar.x1 : bar.y1) : vertical ? bar.x0 : bar.y0;
      const c0 = far ? edge : edge - reach;
      const c1 = far ? edge + reach : edge;
      const [x0, x1, y0, y1] = vertical ? [c0, c1, a0, a1] : [a0, a1, c0, c1];
      const wx0 = clamp(Math.round(x0), 0, img.width - 1);
      const wx1 = clamp(Math.round(x1), wx0 + 1, img.width);
      const wy0 = clamp(Math.round(y0), 0, img.height - 1);
      const wy1 = clamp(Math.round(y1), wy0 + 1, img.height);
      if (wx1 - wx0 < 3 || wy1 - wy0 < 3) continue;
      const dark = differs(background(img, wx0, wy0, wx1, wy1), TEXT);
      const comps = components(wx0, wy0, wx1, wy1, (x, y) => dark(readPixel(img, x, y)));
      // In the bar's frame: along (u) and distance from the strip (d).
      const frame = (c) => ({
        ...c,
        u0: vertical ? c.y0 : c.x0,
        u1: vertical ? c.y1 : c.x1,
        d0: far ? (vertical ? c.x0 : c.y0) - edge : edge - (vertical ? c.x1 : c.y1),
        size: vertical ? c.y1 - c.y0 : c.x1 - c.x0,
        across: vertical ? c.x1 - c.x0 : c.y1 - c.y0,
      });
      const chars = comps
        .map(frame)
        // Tick marks touch the strip and are thin along it; outlines and
        // axis lines run along most of it.
        .filter((c) => !(c.d0 <= 2 && c.size <= 3) && c.size < len * 0.5 && c.n >= 3);
      if (!chars.length) continue;
      const charH = median(chars.map((c) => (vertical ? c.size : c.across)));
      // Labels start near the strip; a title or axis name sits further out.
      const nearest = Math.min(...chars.map((c) => c.d0));
      const near = chars.filter((c) => c.d0 <= nearest + 2.5 * charH);
      // Characters of one label overlap along a vertical bar and sit close
      // together along a horizontal one.
      const gap = vertical ? 1 : Math.max(2, 0.6 * charH);
      near.sort((a, b) => a.u0 - b.u0);
      const groups = [];
      for (const c of near) {
        const g = groups[groups.length - 1];
        if (g && c.u0 <= g.u1 + gap) {
          g.u1 = Math.max(g.u1, c.u1);
          g.box = { x0: Math.min(g.box.x0, c.x0), y0: Math.min(g.box.y0, c.y0), x1: Math.max(g.box.x1, c.x1), y1: Math.max(g.box.y1, c.y1) };
        } else groups.push({ u0: c.u0, u1: c.u1, box: { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 } });
      }
      // Specks smaller than half a character are not labels.
      const labels = groups.filter((g) => Math.max(g.box.x1 - g.box.x0, g.box.y1 - g.box.y0) >= 0.5 * charH);
      if (labels.length > best.marks.length) {
        const mid = vertical ? (bar.x0 + bar.x1) / 2 : (bar.y0 + bar.y1) / 2;
        best = {
          side,
          marks: labels.map((g) => {
            const u = (g.u0 + g.u1) / 2;
            return { at: vertical ? { x: mid, y: u } : { x: u, y: mid }, box: g.box };
          }),
        };
      }
    }
    return best;
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

  Object.assign(CM, { snapBlock, findStrip, findTickLabels, labelReach });
})((globalThis.Colormeris ??= {}));

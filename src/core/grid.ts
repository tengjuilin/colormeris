import type { Corners, Grid, PixelImage, Point, Rgb, UV } from '../types/index.ts';
import { deltaE76, rgbToLab } from './color.ts';

// Heatmap grid geometry and pixel sampling.
// A grid is defined by four points in image pixel space, ordered
// [topLeft, topRight, bottomRight, bottomLeft]: its outer corners, or the
// centers of its corner cells (see outerCorners). Points inside the grid are
// addressed with normalized (u, v) in [0, 1]², u along columns, v along rows.

export function rectCorners(p1: Point, p2: Point): Corners {
  const x0 = Math.min(p1.x, p2.x);
  const x1 = Math.max(p1.x, p2.x);
  const y0 = Math.min(p1.y, p2.y);
  const y1 = Math.max(p1.y, p2.y);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

export function bilinear(corners: Corners, u: number, v: number): Point {
  const [tl, tr, br, bl] = corners;
  const a = (1 - u) * (1 - v);
  const b = u * (1 - v);
  const c = u * v;
  const d = (1 - u) * v;
  return {
    x: a * tl.x + b * tr.x + c * br.x + d * bl.x,
    y: a * tl.y + b * tr.y + c * br.y + d * bl.y,
  };
}

// Inverse bilinear mapping by Newton iteration. Returns {u, v}; values
// outside [0, 1] mean the point lies outside the grid.
export function invertBilinear(corners: Corners, p: Point): UV {
  const [tl, tr, br, bl] = corners;
  let u = 0.5;
  let v = 0.5;
  for (let i = 0; i < 20; i++) {
    const q = bilinear(corners, u, v);
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    if (Math.abs(ex) < 1e-6 && Math.abs(ey) < 1e-6) break;
    const dxdu = (1 - v) * (tr.x - tl.x) + v * (br.x - bl.x);
    const dydu = (1 - v) * (tr.y - tl.y) + v * (br.y - bl.y);
    const dxdv = (1 - u) * (bl.x - tl.x) + u * (br.x - tr.x);
    const dydv = (1 - u) * (bl.y - tl.y) + u * (br.y - tr.y);
    const det = dxdu * dydv - dxdv * dydu;
    if (Math.abs(det) < 1e-12) break;
    u -= (ex * dydv - ey * dxdv) / det;
    v -= (ey * dxdu - ex * dydu) / det;
  }
  return { u, v };
}

// A grid's clicked points are either its outer corners (anchor 'corners', the
// default) or the centers of its four corner cells (anchor 'centers', for dot
// plots without cell borders). Everything below works on the outer corners.
const isCenters = (grid: Grid) => grid.anchor === 'centers';

// Outer corners: for centers, extrapolate half a cell beyond the corner
// cells' centers. A single row or column has no spacing, so it gets none.
export function outerCorners(grid: Grid): Corners {
  if (!isCenters(grid)) return grid.corners!;
  const su = grid.cols > 1 ? 0.5 / (grid.cols - 1) : 0;
  const sv = grid.rows > 1 ? 0.5 / (grid.rows - 1) : 0;
  const c = grid.corners!;
  return [bilinear(c, -su, -sv), bilinear(c, 1 + su, -sv), bilinear(c, 1 + su, 1 + sv), bilinear(c, -su, 1 + sv)];
}

// The inverse: centers of the four corner cells of a grid given by its outer corners.
export function cornerCellCenters(outer: Corners, rows: number, cols: number): Corners {
  const su = 0.5 / cols;
  const sv = 0.5 / rows;
  return [
    bilinear(outer, su, sv),
    bilinear(outer, 1 - su, sv),
    bilinear(outer, 1 - su, 1 - sv),
    bilinear(outer, su, 1 - sv),
  ];
}

export function cellAt(grid: Grid, p: Point) {
  const { u, v } = invertBilinear(outerCorners(grid), p);
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
  return { row: Math.floor(v * grid.rows), col: Math.floor(u * grid.cols) };
}

// Normalized bounds of the sampled (central) part of a cell. With a dot
// radius (centers mode, in image pixels) the bounds follow the dot: a circle
// of sampleFraction × radius, or the square inscribed in it.
export function cellSampleBounds(grid: Grid, row: number, col: number, radius: number | null = null) {
  const uc = (col + 0.5) / grid.cols;
  const vc = (row + 0.5) / grid.rows;
  let hu = grid.sampleFraction / 2 / grid.cols;
  let hv = grid.sampleFraction / 2 / grid.rows;
  if (radius) {
    const { width, height } = gridPixelSize(outerCorners(grid));
    const r = radius * grid.sampleFraction * (grid.shape === 'circle' ? 1 : Math.SQRT1_2);
    hu = r / width;
    hv = r / height;
  }
  return { u0: uc - hu, u1: uc + hu, v0: vc - hv, v1: vc + hv };
}

const CIRCLE_POINTS = 32;

export function cellSamplePolygon(grid: Grid, row: number, col: number, radius: number | null = null) {
  const { u0, u1, v0, v1 } = cellSampleBounds(grid, row, col, radius);
  const c = outerCorners(grid);
  if (grid.shape === 'circle') {
    const uc = (u0 + u1) / 2;
    const vc = (v0 + v1) / 2;
    return Array.from({ length: CIRCLE_POINTS }, (_, i) => {
      const a = (i / CIRCLE_POINTS) * 2 * Math.PI;
      return bilinear(c, uc + ((u1 - u0) / 2) * Math.cos(a), vc + ((v1 - v0) / 2) * Math.sin(a));
    });
  }
  return [bilinear(c, u0, v0), bilinear(c, u1, v0), bilinear(c, u1, v1), bilinear(c, u0, v1)];
}

// Read one pixel as [r, g, b], compositing transparency onto white.
export function readPixel(img: PixelImage, x: number, y: number): Rgb {
  const xi = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const yi = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  const i = (yi * img.width + xi) * 4;
  const d = img.data;
  const a = d[i + 3] / 255;
  if (a >= 1) return [d[i], d[i + 1], d[i + 2]];
  return [d[i] * a + 255 * (1 - a), d[i + 1] * a + 255 * (1 - a), d[i + 2] * a + 255 * (1 - a)];
}

// Median of a typed array (sorted in place; typed-array sort is numeric).
function median(values: Float32Array | Float64Array) {
  values.sort();
  const m = values.length >> 1;
  return values.length % 2 ? values[m] : (values[m - 1] + values[m]) / 2;
}

// Per-channel median color over the central part of a cell (a circle keeps
// only the samples inside the inscribed ellipse). Sampling density is
// roughly one sample per image pixel. Same samples as readPixel at
// bilinear(u, v), inlined: this runs for every pixel of every cell.
export function sampleCell(img: PixelImage, grid: Grid, row: number, col: number, radius: number | null = null): Rgb {
  const { u0, u1, v0, v1 } = cellSampleBounds(grid, row, col, radius);
  const c = outerCorners(grid);
  const { width, height } = gridPixelSize(c);
  const nu = Math.max(1, Math.ceil(width * (u1 - u0)));
  const nv = Math.max(1, Math.ceil(height * (v1 - v0)));
  const n = nu * nv;
  const rs = new Float64Array(n);
  const gs = new Float64Array(n);
  const bs = new Float64Array(n);
  const { width: W, height: H, data: d } = img;
  const [tl, tr, br, bl] = c;
  const circle = grid.shape === 'circle' && nu > 1 && nv > 1;
  let k = 0;
  for (let j = 0; j < nv; j++) {
    const fv = (j + 0.5) / nv;
    const v = v0 + fv * (v1 - v0);
    // Along a row of samples the bilinear map is linear in u: left + u * span.
    const lx = tl.x + v * (bl.x - tl.x);
    const ly = tl.y + v * (bl.y - tl.y);
    const sx = tr.x + v * (br.x - tr.x) - lx;
    const sy = tr.y + v * (br.y - tr.y) - ly;
    for (let i = 0; i < nu; i++) {
      const fu = (i + 0.5) / nu;
      if (circle && (2 * fu - 1) ** 2 + (2 * fv - 1) ** 2 > 1) continue;
      const u = u0 + fu * (u1 - u0);
      const xi = Math.min(W - 1, Math.max(0, Math.round(lx + u * sx)));
      const yi = Math.min(H - 1, Math.max(0, Math.round(ly + u * sy)));
      const q = (yi * W + xi) * 4;
      const a = d[q + 3] / 255;
      if (a >= 1) {
        rs[k] = d[q];
        gs[k] = d[q + 1];
        bs[k] = d[q + 2];
      } else {
        rs[k] = d[q] * a + 255 * (1 - a);
        gs[k] = d[q + 1] * a + 255 * (1 - a);
        bs[k] = d[q + 2] * a + 255 * (1 - a);
      }
      k++;
    }
  }
  return [median(rs.subarray(0, k)), median(gs.subarray(0, k)), median(bs.subarray(0, k))];
}

// ---- Dot radius (centers mode) ---------------------------------------------

const DOT_RAYS = 16;
// A cell whose center is this close (ΔE76) to the background has no dot.
const DOT_MIN_CONTRAST = 10;
const DOT_MIN_RADIUS = 1.5;

function medianColor(colors: Rgb[]) {
  return [0, 1, 2].map((ch) => median(Float64Array.from(colors, (c) => c[ch])));
}

// Radius in image pixels of the dot centered in a cell, or null when the cell
// has no dot. The background is read at the cell's corners (between dots);
// rays from the center stop where the color leaves the dot, about halfway
// between dot and background, and the radius is their median length.
export function dotRadius(img: PixelImage, grid: Grid, row: number, col: number) {
  const c = outerCorners(grid);
  const { width, height } = gridPixelSize(c);
  const center = bilinear(c, (col + 0.5) / grid.cols, (row + 0.5) / grid.rows);
  const near: Rgb[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) near.push(readPixel(img, center.x + dx, center.y + dy));
  const dot = rgbToLab(medianColor(near));
  const cornersRgb = [
    [col, row],
    [col + 1, row],
    [col + 1, row + 1],
    [col, row + 1],
  ].map(([i, j]) => {
    const p = bilinear(c, i / grid.cols, j / grid.rows);
    return readPixel(img, p.x, p.y);
  });
  const contrast = deltaE76(dot, rgbToLab(medianColor(cornersRgb)));
  if (contrast < DOT_MIN_CONTRAST) return null;
  const limit = Math.max(12, contrast / 2);
  const maxR = Math.min(width / grid.cols, height / grid.rows) / 2;
  const lengths = new Float64Array(DOT_RAYS);
  for (let i = 0; i < DOT_RAYS; i++) {
    const a = (i / DOT_RAYS) * 2 * Math.PI;
    let s = 0.5;
    while (
      s < maxR &&
      deltaE76(dot, rgbToLab(readPixel(img, center.x + s * Math.cos(a), center.y + s * Math.sin(a)))) <= limit
    )
      s += 0.5;
    lengths[i] = Math.min(s, maxR);
  }
  const r = median(lengths);
  return r >= DOT_MIN_RADIUS ? r : null;
}

// ---- Text printed in cells ------------------------------------------------
//
// Values printed in the cells (one-decimal numbers on framed cells, t18)
// put more color steps across a row than its borders do: their strokes
// gave 10 rows for 5 and 21 rows for 7. Strokes of dark text are short
// dark dips on a line, darker than the cell on both sides; grid lines and
// frames are dark on most lines at the same place and stay. Each dip is
// painted over with the colors on its two sides, so a border under a
// label stays at its place. `rgb`: lines × N samples (entry (j * N + i) *
// 3), changed in place; `pxPerSample` sets the longest dip (a glyph).
// Returns the share of samples painted.
const TEXT_DARK = 110; // mean channel level of a text stroke, at most
const TEXT_CHROMA = 60; // and its chroma (black text, anti-aliased on color)
const TEXT_DIP = 60; // darker than the cell on both sides by this much
const TEXT_RUN_PX = 16; // longest stroke along a line (a digit's height)
export function suppressText(rgb: Float32Array, N: number, lines: number, pxPerSample = 1) {
  const maxRun = Math.max(2, Math.round(TEXT_RUN_PX / pxPerSample));
  const at = (j: number, i: number) => (j * N + i) * 3;
  const level = (k: number) => (rgb[k] + rgb[k + 1] + rgb[k + 2]) / 3;
  const dark = (k: number) =>
    level(k) <= TEXT_DARK &&
    Math.max(rgb[k], rgb[k + 1], rgb[k + 2]) - Math.min(rgb[k], rgb[k + 1], rgb[k + 2]) <= TEXT_CHROMA;
  // Samples dark on most lines are a grid line or frame (dark on all
  // lines but the gaps between cells; text covers half of a line at most).
  const ruled = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    let n = 0;
    for (let j = 0; j < lines; j++) n += Number(dark(at(j, i)));
    ruled[i] = n >= 0.75 * lines ? 1 : 0;
  }
  let painted = 0;
  for (let j = 0; j < lines; j++) {
    for (let i = 1; i < N - 1; i++) {
      if (ruled[i] || !dark(at(j, i))) continue;
      let e = i;
      while (e + 1 < N - 1 && !ruled[e + 1] && dark(at(j, e + 1))) e++;
      // The anti-aliased rim of the stroke goes with it.
      const a = Math.max(1, i - 1);
      const b = Math.min(N - 2, e + 1);
      const next = e;
      i = next;
      if (b - a + 1 > maxRun || ruled[a - 1] || ruled[b + 1]) continue;
      let low = Infinity;
      for (let k = a; k <= b; k++) low = Math.min(low, level(at(j, k)));
      const L = at(j, a - 1);
      const R = at(j, b + 1);
      if (level(L) - low < TEXT_DIP || level(R) - low < TEXT_DIP) continue;
      const half = (a + b) / 2;
      for (let k = a; k <= b; k++) rgb.copyWithin(at(j, k), k <= half ? L : R, (k <= half ? L : R) + 3);
      painted += b - a + 1;
    }
  }
  return painted / (N * lines);
}

// ---- Grid size detection -------------------------------------------------

const MAX_PROFILE_SAMPLES = 1500;
const MAX_PROFILE_LINES = 200;
const MAX_CELLS = 200;
// Minimum periodicity (normalized autocorrelation contrast) to accept any
// split at all; below this the area is treated as a single cell.
const MIN_SCORE = 0.1;
// Minimum strength of the strongest edge (mean |ΔR|+|ΔG|+|ΔB| per line).
const MIN_EDGE = 4;

export function gridPixelSize(corners: Corners) {
  const c = corners;
  return {
    width: Math.max(Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y), Math.hypot(c[2].x - c[3].x, c[2].y - c[3].y)),
    height: Math.max(Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y), Math.hypot(c[2].x - c[1].x, c[2].y - c[1].y)),
  };
}

// Color change between neighbouring samples along one axis, summed over
// lines across the other axis. `axis` is 'u' (profile across columns) or 'v'
// (profile across rows). Entry i is the mean change (|ΔR|+|ΔG|+|ΔB| per line)
// between samples i-1 and i.
// `pxPerSample` (optional): text printed in the cells is painted over
// first (suppressText).
export function edgeProfile(
  img: PixelImage,
  corners: Corners,
  axis: 'u' | 'v',
  samples: number,
  lines: number,
  pxPerSample: number | null = null,
) {
  const rgb = new Float32Array(lines * samples * 3);
  for (let j = 0; j < lines; j++) {
    const w = (j + 0.5) / lines;
    for (let i = 0; i < samples; i++) {
      const s = (i + 0.5) / samples;
      const p = axis === 'u' ? bilinear(corners, s, w) : bilinear(corners, w, s);
      rgb.set(readPixel(img, p.x, p.y), (j * samples + i) * 3);
    }
  }
  if (pxPerSample) suppressText(rgb, samples, lines, pxPerSample);
  const prof = new Float64Array(samples);
  for (let j = 0; j < lines; j++)
    for (let i = 1; i < samples; i++) {
      const a = (j * samples + i - 1) * 3;
      const b = a + 3;
      prof[i] += Math.abs(rgb[b] - rgb[a]) + Math.abs(rgb[b + 1] - rgb[a + 1]) + Math.abs(rgb[b + 2] - rgb[a + 2]);
    }
  for (let i = 0; i < samples; i++) prof[i] /= lines;
  return prof;
}

// Normalized autocorrelation of a profile for lags 0..maxLag. It depends only
// on the spacing of the edges, not on where they start, so it is insensitive
// to grid corners placed a few pixels off.
export function autocorrelation(prof: ArrayLike<number>, maxLag: number) {
  const N = prof.length;
  let mean = 0;
  for (let i = 1; i < N; i++) mean += prof[i];
  mean /= Math.max(1, N - 1);
  const x = new Float64Array(N);
  for (let i = 1; i < N; i++) x[i] = prof[i] - mean;
  const ac = new Float64Array(maxLag + 1);
  for (let L = 0; L <= maxLag; L++) {
    let sum = 0;
    for (let i = 1; i + L < N; i++) sum += x[i] * x[i + L];
    ac[L] = sum / (N - 1 - L);
  }
  const zero = ac[0];
  if (zero > 0) for (let L = 0; L <= maxLag; L++) ac[L] /= zero;
  return ac;
}

// How well a cell size of P samples explains the edge spacing:
// autocorrelation at multiples of P minus autocorrelation halfway between
// them. Cell sizes that are multiples of the true one (fewer, bigger cells)
// are penalized when their midpoints fall on real spacings; fractions of it
// (more, smaller cells) because many of their lags are empty.
export function scorePeriod(ac: ArrayLike<number>, P: number) {
  const maxLag = ac.length - 1;
  const peak = (lag: number) => {
    // Tolerance grows with lag to absorb a slightly wrong cell size, but stays
    // well inside one cell so neighbouring spacings are not picked up.
    const r = Math.max(1, Math.min(P / 4, 1 + 0.02 * lag));
    const lo = Math.max(1, Math.round(lag - r));
    const hi = Math.min(maxLag, Math.round(lag + r));
    let m = -Infinity;
    for (let i = lo; i <= hi; i++) if (ac[i] > m) m = ac[i];
    return m;
  };
  let on = 0;
  let onCount = 0;
  for (let m = 1; m * P <= maxLag + 0.5; m++, onCount++) on += peak(m * P);
  let off = 0;
  let offCount = 0;
  for (let m = 1; (m - 0.5) * P <= maxLag; m++, offCount++) off += peak((m - 0.5) * P);
  if (!onCount || !offCount) return 0;
  return on / onCount - off / offCount;
}

// Count whole cells inside the placed range given an estimated cell size P0.
// Finds where the boundaries sit, then counts cells whose centre is inside the
// range, so a cell cut by a slightly too-small box still counts, and drops
// end cells with no outer edge, so white margin from a too-large box does not.
export function countCells(prof: ArrayLike<number>, P0: number, margin: number) {
  const N = prof.length;
  const r = Math.max(1, Math.min(P0 / 4, 2));
  // Edge strength near a position, discounted by distance so an exactly
  // aligned boundary comb beats one that merely stays within the window.
  const peak = (pos: number) => {
    const lo = Math.max(1, Math.round(pos - r));
    const hi = Math.min(N - 1, Math.round(pos + r));
    let m = 0;
    for (let i = lo; i <= hi; i++) m = Math.max(m, prof[i] * (1 - Math.abs(i - pos) / (r + 1)));
    return m;
  };
  // Fit the cell size (within ±8% of the estimate; no harmonic is that close)
  // and the phase so the boundary comb best matches the edges away from the ends.
  let P = P0;
  let phase = 0;
  let bestSum = -1;
  for (let f = 0.92; f <= 1.08 + 1e-9; f += 0.002) {
    const Pf = P0 * f;
    for (let phi = 0; phi < Pf; phi += 0.5) {
      let sum = 0;
      let teeth = 0;
      for (let pos = phi; pos < N; pos += Pf) {
        if (pos >= margin && pos <= N - margin) {
          sum += peak(pos);
          teeth++;
        }
      }
      // Mean, not sum, so smaller sizes do not win just by having more teeth.
      if (teeth) sum /= teeth;
      if (sum > bestSum) {
        bestSum = sum;
        phase = phi;
        P = Pf;
      }
    }
  }
  const interior: number[] = [];
  for (let pos = phase; pos < N; pos += P) if (pos >= margin && pos <= N - margin) interior.push(peak(pos));
  interior.sort((a, b) => a - b);
  const typical = interior.length ? interior[interior.length >> 1] : 0;
  const threshold = 0.25 * typical;
  // Boundaries outside the placed range cannot be checked; assume the grid continues.
  const present = (pos: number) => pos < 0.5 || pos > N - 1.5 || peak(pos) >= threshold;
  // Cells whose centre is inside the placed range; then drop cells at either
  // end whose outer boundary shows no edge (margin outside the heatmap).
  // Interior boundaries may legitimately be faint (similar neighbouring
  // colors), so they are not checked.
  const cells: number[] = [];
  for (let k = -1; phase + k * P < N; k++) {
    const a = phase + k * P;
    const centre = a + P / 2;
    if (centre >= 0 && centre <= N) cells.push(a);
  }
  while (cells.length > 1 && !present(cells[0])) cells.shift();
  while (cells.length > 1 && !present(cells[cells.length - 1] + P)) cells.pop();
  return Math.max(1, cells.length);
}

const MIN_CELL = 4; // samples
const PERIOD_STEP = 1.005; // relative step of the cell-size search

// Estimate the cell count along one profile. The cell size is searched
// continuously rather than as width / n, so a grid placed a few pixels too
// wide or narrow still yields the right count.
export function bestCount(profile: ArrayLike<number>) {
  const N = profile.length;
  if (N < 2 * MIN_CELL) return { count: 1, confidence: 0 };
  // Ignore the ends: frame lines, axis ticks and margins just outside or
  // inside a roughly placed grid would otherwise dominate the profile.
  const prof = Float64Array.from(profile);
  const margin = Math.round(2 + 0.02 * N);
  let mid = 0;
  for (let i = margin; i < N - margin; i++) mid += prof[i];
  mid /= Math.max(1, N - 2 * margin);
  for (let i = 0; i < Math.min(margin, N); i++) prof[i] = prof[N - 1 - i] = mid;
  // Treat areas without clear color changes as one cell; the autocorrelation
  // below is scale-free and would otherwise find patterns in pixel noise.
  let strongest = 0;
  for (let i = margin; i < N - margin; i++) strongest = Math.max(strongest, prof[i]);
  if (strongest < MIN_EDGE) return { count: 1, confidence: 0 };

  // Lags a bit beyond N/2 so a two-cell grid (P = N/2) is not at the edge.
  const ac = autocorrelation(prof, Math.floor(0.6 * N));
  const minP = Math.max(MIN_CELL, N / MAX_CELLS);
  const cands: { P: number; score: number }[] = [];
  let best: { P: number; score: number } | null = null;
  for (let P = minP; P <= N / 2 + 1e-9; P *= PERIOD_STEP) {
    const c = { P, score: scorePeriod(ac, P) };
    cands.push(c);
    if (!best || c.score > best.score) best = c;
  }
  if (!best || best.score < MIN_SCORE) return { count: 1, confidence: 0 };
  // A multiple of the true cell size by an odd factor (e.g. 3 cells merged)
  // scores as well as the true size, because its midpoints fall between real
  // boundaries; fractions of the true size score only about 1/k as well. So
  // move to a fraction while it keeps most of the score, refining the size
  // around it. (Even factors are already penalized by the midpoint term.)
  const refine = (P: number) => {
    let b = { P, score: scorePeriod(ac, P) };
    for (let f = 0.97; f <= 1.03; f += 0.005) {
      const s = scorePeriod(ac, P * f);
      if (s > b.score) b = { P: P * f, score: s };
    }
    return b;
  };
  for (let grew = true; grew; ) {
    grew = false;
    for (const k of [3, 5, 7]) {
      if (best.P / k < minP) continue;
      const c = refine(best.P / k);
      if (c.score >= 0.6 * best.score) {
        best = c;
        grew = true;
        break;
      }
    }
  }
  // Runner-up among sizes that are not simple multiples or fractions of the winner.
  const harmonic = (P: number) => {
    const r = P > best!.P ? P / best!.P : best!.P / P;
    // Near-harmonics (within 10%) score highly just from the peak tolerance.
    return Math.abs(r - Math.round(r)) < 0.1 * r;
  };
  let runner = 0;
  for (const c of cands) if (!harmonic(c.P)) runner = Math.max(runner, c.score);
  return { count: countCells(profile, best.P, margin), confidence: runner > 0 ? best.score / runner : Infinity };
}

// Guess the number of rows and columns inside a placed grid from where its
// colors change. Returns {rows, cols, rowConfidence, colConfidence}; a
// confidence below ~1.3 means the guess is uncertain.
export function detectGridSize(img: PixelImage, corners: Corners) {
  const { width, height } = gridPixelSize(corners);
  const W = Math.max(2, Math.min(MAX_PROFILE_SAMPLES, Math.round(width)));
  const H = Math.max(2, Math.min(MAX_PROFILE_SAMPLES, Math.round(height)));
  const colFit = bestCount(edgeProfile(img, corners, 'u', W, Math.min(MAX_PROFILE_LINES, H), width / W));
  const rowFit = bestCount(edgeProfile(img, corners, 'v', H, Math.min(MAX_PROFILE_LINES, W), height / H));
  return { rows: rowFit.count, cols: colFit.count, rowConfidence: rowFit.confidence, colConfidence: colFit.confidence };
}

// ---- Cell counts from cell borders ---------------------------------------
//
// fitCellCounts looks for where the cell borders are, not only how far
// apart edges are (detectGridSize): a comb of evenly spaced teeth that land
// on color edges while the cell middles between them stay flat. Its cell
// size and start are fitted freely, so corners a few pixels off, or a frame,
// tick marks or a margin inside the box, do not change the count (fitting
// k cells exactly between the corners did: a 7 px frame on 37 px rows gave
// 339 rows for 40). Evidence for a border is the share of lines across the
// grid that change color there, not the mean change: a dendrogram or a
// label touching a few lines is strong but rare, and borders between
// near-equal replicate cells are faint but show on many lines.

const FIT_LINES = 64;
// Lines come from the middle 80% of the other axis, so a frame or margin
// at the ends of a rough box does not hide the borders.
const FIT_INSET = 0.1;
// A color step (|ΔR|+|ΔG|+|ΔB| over two samples) counts above this, or
// above twice the image's noise when that is larger.
// Replicate cells differ by 16–23 on the 32 × 9 cytokine heatmap.
const STEP_MIN = 12;
// A border counts in full when this share of lines changes color there:
// neighbouring cells of equal color hide the rest.
const BORDER_SHARE = 0.3;
// Counts within this score of the best one are ties; the most cells win
// (3 cells per tooth fit as well as 1 when every border is strong).
const COUNT_TIE = 0.08;
// Below this the borders are not where any even spacing puts them.
const MIN_FIT = 0.25;
// The smallest cell, in pixels (antialiased 1–2 px lines are not cells).
const MIN_CELL_PX = 3;
// Page white: every channel at least this.
const GAP_WHITE = 245;

/** Border evidence per sample of one axis (borderEvidence). */
interface Evidence {
  edge: Float64Array;
  ramp: Float64Array;
  light: Float64Array;
  sep: Uint8Array;
}

/** A comb of cell size P (samples) starting at `phase`, with its search score. */
interface CombFit {
  P: number;
  phase: number;
  r: number;
  score: number;
}

/** fitProfile's result for one axis. */
interface AxisFit {
  count: number;
  score: number;
  rank: number;
  alt: number | null;
  altScore: number;
  size: number;
  sizeSamples: number;
  span: number[];
  reason: string;
  wideRun?: boolean;
  runs?: number;
}

// Colors along one axis: entry (j * N + i) * 3 is line j, sample i.
function axisColors(img: PixelImage, corners: Corners, axis: 'u' | 'v', N: number, lines: number) {
  const out = new Float32Array(lines * N * 3);
  for (let j = 0; j < lines; j++) {
    const w = FIT_INSET + ((1 - 2 * FIT_INSET) * (j + 0.5)) / lines;
    for (let i = 0; i < N; i++) {
      const s = (i + 0.5) / N;
      const p = axis === 'u' ? bilinear(corners, s, w) : bilinear(corners, w, s);
      out.set(readPixel(img, p.x, p.y), (j * N + i) * 3);
    }
  }
  return out;
}

// Per sample: `edge`, the share of lines whose color changes most steeply
// there; `ramp`, the share changing at all; `light`, the share that is page
// white; and `sep`, whether it is a separator: one neutral color (a white
// gap, a black or gray line, a frame) on nearly all lines. A column of
// cells is never one color on every line, unless all its cells are equal.
function borderEvidence(rgb: Float32Array, N: number, lines: number): Evidence {
  const steps = new Float32Array(lines * N);
  const at = (j: number, i: number) => (j * N + i) * 3;
  for (let j = 0; j < lines; j++)
    for (let i = 1; i < N - 1; i++) {
      const a = at(j, i - 1);
      const b = at(j, i + 1);
      steps[j * N + i] =
        Math.abs(rgb[a] - rgb[b]) + Math.abs(rgb[a + 1] - rgb[b + 1]) + Math.abs(rgb[a + 2] - rgb[b + 2]);
    }
  // Above the noise: JPEG artifacts make a quarter of the steps 13 or more
  // on some figures, and none on a clean one.
  const sorted = Float32Array.from(steps).sort();
  const T = Math.max(STEP_MIN, 2 * sorted[Math.floor(0.75 * (sorted.length - 1))]);
  const edge = new Float64Array(N);
  const ramp = new Float64Array(N);
  const light = new Float64Array(N);
  const sep = new Uint8Array(N);
  const ch = [new Float32Array(lines), new Float32Array(lines), new Float32Array(lines)];
  // A blurred or upscaled border changes color over several samples; it
  // counts once per line, where the change is steepest.
  const steepest = (j: number, i: number) => {
    const d = steps[j * N + i];
    for (let k = Math.max(1, i - 2); k <= Math.min(N - 2, i + 2); k++)
      if (steps[j * N + k] > d || (steps[j * N + k] === d && k < i)) return false;
    return true;
  };
  for (let i = 0; i < N; i++) {
    let n = 0;
    let r = 0;
    for (let j = 0; j < lines; j++) {
      if (steps[j * N + i] > T) r++, steepest(j, i) && n++;
      for (let k = 0; k < 3; k++) ch[k][j] = rgb[at(j, i) + k];
    }
    edge[i] = n / lines;
    ramp[i] = r / lines;
    let w = 0;
    for (let j = 0; j < lines; j++) w += Number(Math.min(ch[0][j], ch[1][j], ch[2][j]) >= GAP_WHITE);
    light[i] = w / lines;
    const m = ch.map((c) => median(Float32Array.from(c)));
    if (Math.max(...m) - Math.min(...m) > 30) continue;
    let same = 0;
    for (let j = 0; j < lines; j++)
      if (Math.abs(ch[0][j] - m[0]) + Math.abs(ch[1][j] - m[1]) + Math.abs(ch[2][j] - m[2]) <= 30) same++;
    // 2 for a dark line (frame, black grid line), 1 for a light one.
    sep[i] = same >= 0.9 * lines ? (Math.max(...m) < 128 ? 2 : 1) : 0;
  }
  return { edge, ramp, light, sep };
}

// Each separator run between cells, with the color ramps into and out of
// it, becomes one border at its middle, so a white gap counts once, not as
// two edges (5 × 5 cells with 8 px gaps came out 10 × 10). With `compress`
// the run also shrinks to that one sample, so groups of cells split by
// gaps wider than the lines inside a group fall on one even spacing; this
// is tried as well, since it shifts every later border when only some
// lines between cells are found (rows 1–2 px apart on a JPEG). Runs at the
// ends (frame, margin) stay, and so do runs `maxRun` wide or more (a
// column of white cells). `orig` maps samples back.
function collapseSeparators({ edge, ramp, light, sep }: Evidence, maxRun: number, compress: boolean) {
  const N = edge.length;
  // Noise puts steps anywhere on a share of lines; most samples are not
  // borders, so a high quantile of the shares is that noise level.
  const base = Float64Array.from(edge).sort()[Math.floor(0.75 * (N - 1))];
  const b: number[] = [];
  const orig: number[] = [];
  const isSep: number[] = [];
  const pale: number[] = [];
  const runs: [number, number][] = [];
  let done = 0; // the last sample of the previous run, which stays put
  const keep = (i: number) => {
    b.push(Math.min(1, Math.max(0, edge[i] - base) / ((1 - base) * BORDER_SHARE)));
    orig.push(i);
    isSep.push(sep[i]);
    pale.push(light[i]);
  };
  for (let i = 0; i < N; i++) {
    if (sep[i]) {
      let j = i;
      while (j + 1 < N && sep[j + 1]) j++;
      if (i > 1 && j < N - 2 && j - i + 1 < maxRun) {
        // The color ramps into and out of the gap go with it.
        let a = i;
        let c = j;
        while (a > done + 1 && i - a < 4 && ramp[a - 1] >= 0.5 && orig[orig.length - 1] === a - 1)
          a--, b.pop(), orig.pop(), isSep.pop(), pale.pop();
        while (c < N - 2 && c - j < 4 && ramp[c + 1] >= 0.5) c++;
        const mid = Math.round((i + j) / 2);
        for (let k = compress ? mid : a; k <= (compress ? mid : c); k++) {
          b.push(k === mid ? 1 : 0);
          orig.push(compress ? (i + j) / 2 : k);
          isSep.push(0);
          pale.push(compress ? 0 : light[k]);
        }
        runs.push([i, j + 1]);
        i = done = c;
        continue;
      }
      // A run that stays is kept whole (not looked at again from inside).
      for (let k = i; k <= j; k++) keep(k);
      i = j;
      continue;
    }
    keep(i);
  }
  return { b: Float64Array.from(b), orig, isSep, pale, runs };
}

// Best comb for cell size P (in samples), with the profile folded modulo
// P so all starts are scored at once. A comb is good when its teeth land on
// borders (the evidence within a few samples, nearer counts more), when it
// explains the borders (the share of all evidence on its teeth: a comb of
// 3 cells per tooth leaves 2 of 3 clear borders out) and when the middle
// 40% of its cells is flat.
function combAt(wins: Float64Array[], b: Float64Array, P: number, total: number): CombFit {
  const B = Math.ceil(P);
  // Blurred borders wander a few samples from line to line; the teeth
  // take what is within 6% of a cell (1 to 3 samples).
  const r = Math.max(1, Math.min(3, Math.round(0.06 * P)));
  const win = wins[r];
  const teeth = new Float64Array(B);
  const flat = new Float64Array(B);
  const strong = new Float64Array(B);
  const n = new Float64Array(B);
  for (let i = 1; i < b.length - 1; i++) {
    const k = Math.floor(i % P);
    teeth[k] += win[i];
    flat[k] += b[i];
    strong[k] += Number(b[i] >= 0.5);
    n[k]++;
  }
  // Prefix sums over two turns for the circular middle windows.
  const F = new Float64Array(2 * B + 1);
  const C = new Float64Array(2 * B + 1);
  for (let k = 0; k < 2 * B; k++) {
    F[k + 1] = F[k] + flat[k % B];
    C[k + 1] = C[k] + n[k % B];
  }
  const lo = Math.round(0.3 * P);
  const hi = Math.round(0.7 * P);
  let best: CombFit = { P, phase: 0, r, score: -Infinity };
  for (let k = 0; k < B; k++) {
    if (!n[k]) continue;
    const m = C[k + hi + 1] - C[k + lo];
    const middle = m ? (F[k + hi + 1] - F[k + lo]) / m : 0;
    let near = 0;
    for (let d = -r; d <= r; d++) near += strong[(k + d + B) % B];
    // Beyond what 2r + 1 samples in every B would hold by chance.
    const chance = (2 * r + 1) / B;
    const explained = Math.max(0, (near / total - chance) / (1 - chance));
    const score = (teeth[k] / n[k]) * Math.min(1, explained) - middle;
    if (score > best.score) best = { P, phase: k, r, score };
  }
  return best;
}

// How well the comb (P, phase) explains the profile, as reported: the
// share of its inner teeth on a clear border, times the share of clear
// borders on its teeth, less the edge evidence in its cell middles. Near 1
// means every border was seen where the count puts it; the search score
// (discounted and corrected for chance) only ranks sizes.
function combFit(fit: CombFit, b: Float64Array) {
  const { P, phase } = fit;
  const M = b.length;
  // A border's two color ramps (a blurred white line) lie within 10% of a
  // cell of its middle.
  const r = Math.max(fit.r, Math.round(0.1 * P));
  const onTooth = new Uint8Array(M);
  let teeth = 0;
  let hits = 0;
  let middle = 0;
  let midN = 0;
  for (let k = Math.ceil((r + 2 - phase) / P); phase + k * P < M - r - 2; k++) {
    const t = Math.round(phase + k * P);
    let hit = false;
    for (let i = t - r; i <= t + r; i++) (onTooth[i] = 1), (hit ||= b[i] >= 0.5);
    teeth++;
    hits += Number(hit);
  }
  let clear = 0;
  let on = 0;
  for (let i = 1; i < M - 1; i++) if (b[i] >= 0.5) clear++, (on += onTooth[i]);
  for (let k = Math.floor(-phase / P); phase + k * P < M; k++)
    for (let i = Math.ceil(phase + (k + 0.3) * P); i <= phase + (k + 0.7) * P; i++)
      if (i >= 0 && i < M) (middle += b[i]), midN++;
  if (!teeth || !clear) return 0;
  return Math.max(0, (hits / teeth) * (on / clear) - (midN ? middle / midN : 0));
}

// The comb through the borders it found, by least squares: the size
// search steps leave up to a sample of drift per cell size step, which
// over 30 rows misses the last border.
function refineComb(fit: CombFit, b: Float64Array): CombFit {
  const { P, phase, r } = fit;
  const pts: [number, number][] = [];
  for (let k = Math.ceil(-phase / P); phase + k * P < b.length; k++) {
    const t = Math.round(phase + k * P);
    let best = -1;
    for (let i = Math.max(0, t - r); i <= Math.min(b.length - 1, t + r); i++)
      if (b[i] >= 0.5 && (best < 0 || b[i] > b[best])) best = i;
    if (best >= 0) pts.push([k, best]);
  }
  if (pts.length < 3) return fit;
  const n = pts.length;
  const mk = pts.reduce((s, [k]) => s + k, 0) / n;
  const mt = pts.reduce((s, [, t]) => s + t, 0) / n;
  let num = 0;
  let den = 0;
  for (const [k, t] of pts) (num += (k - mk) * (t - mt)), (den += (k - mk) ** 2);
  const P2 = num / den;
  if (!(Math.abs(P2 - P) < 0.05 * P)) return fit;
  return { ...fit, P: P2, phase: mt - mk * P2 };
}

// Cells of the comb (P, phase) inside the profile: each pair of teeth
// mostly inside it, less end cells whose outer tooth shows no border or
// that are blank (a margin inside the box). Teeth at or past the ends
// cannot be checked; their cells are kept unless blank.
function combCells(fit: CombFit, wins: Float64Array[], isSep: number[], pale: number[]) {
  const { P, phase, r } = fit;
  const win = wins[r];
  const M = win.length;
  // Teeth this close to an end cannot be checked (the border may be the
  // box's own edge); they count when their cell is not blank.
  const edgeZone = (t: number) => t < r + 2 || t > M - r - 3;
  // End teeth may sit a few samples off the outer borders (sizes vary a
  // little across a rendered heatmap): they look within 15% of a cell.
  const reachOut = Math.max(r + 1, Math.round(0.15 * P));
  const present = (t: number) => {
    if (edgeZone(t)) return true;
    for (let i = Math.max(0, Math.round(t) - reachOut); i <= Math.min(M - 1, Math.round(t) + reachOut); i++)
      if (wins[0][i] >= 0.5 || isSep[i] === 2) return true;
    return false;
  };
  // An end cell that is mostly page white (a few tick marks or label
  // strokes aside) is margin, unless a dark line or a border (the frame)
  // closes it off on the outside: then it is a row of white cells (zeros
  // on a diverging map). A margin has the frame on its inside.
  const blank = (a: number, first: boolean) => {
    const lo = Math.max(0, Math.ceil(a));
    const hi = Math.min(M, a + P);
    let s = 0;
    // Most of a cell inside the box: blank only when one even color (a
    // white cell has pale neighbours on some lines, tick marks below a
    // frame do not make a cell).
    const most = hi - lo >= 0.75 * P;
    for (let i = lo; i < hi; i++) s += Number(most ? isSep[i] === 1 : pale[i]);
    if (hi <= lo || s <= 0.6 * (hi - lo)) return hi <= lo;
    const reach = 0.4 * P;
    for (let i = lo; i < hi; i++)
      if ((isSep[i] === 2 || wins[0][i] >= 0.5) && (first ? i - lo : hi - 1 - i) < reach) return false;
    return true;
  };
  const starts: number[] = [];
  // Cells with 60% of their size inside the box: a cell cut by a box a
  // few pixels small still counts; a band under half a cell past the
  // frame (tick marks, a label row) does not.
  for (let t = phase - Math.ceil(phase / P + 1) * P; t < M; t += P)
    if (t + 0.4 * P >= 0 && t + 0.6 * P <= M) starts.push(t);
  // White end cells cut by the box can be margin or white cells (zeros);
  // they are dropped and counted, for the caller to weigh.
  let white = 0;
  const keep = (t: number, outer: number) => {
    if (!present(outer)) return false;
    if (edgeZone(outer) && blank(t, outer === t)) return !++white;
    return true;
  };
  while (starts.length > 1 && !keep(starts[0], starts[0])) starts.shift();
  while (starts.length > 1 && !keep(starts[starts.length - 1], starts[starts.length - 1] + P)) starts.pop();
  return { count: starts.length, start: starts[0], end: starts[starts.length - 1] + P, white };
}

// Fit one axis: {count, score, alt, altScore, size, span: [a, b] (0–1
// along the axis, where the counted cells start and end), reason}.
function fitAxis(img: PixelImage, corners: Corners, axis: 'u' | 'v') {
  const { width, height } = gridPixelSize(corners);
  const len = axis === 'u' ? width : height;
  const N = Math.max(2, Math.min(MAX_PROFILE_SAMPLES, Math.round(len)));
  const lines = Math.min(FIT_LINES, Math.max(4, Math.round(axis === 'u' ? height : width)));
  const pxPerSample = len / N;
  const rgb = axisColors(img, corners, axis, N, lines);
  suppressText(rgb, N, lines, pxPerSample);
  const ev = borderEvidence(rgb, N, lines);
  const fit = (compress: boolean) => {
    const f = fitProfile(ev, Infinity, compress, pxPerSample);
    // A run as wide as half a cell is a column of white cells, not a gap.
    return f.wideRun ? fitProfile(ev, 0.5 * f.sizeSamples, compress, pxPerSample) : f;
  };
  let out = fit(false);
  if (out.runs) {
    const grouped = fit(true);
    // Only when clearly better: shrinking gaps also eats into noisy cells.
    if (grouped.rank > out.rank + 0.05)
      out = { ...grouped, reason: grouped.reason === 'clean' ? 'clean, groups' : grouped.reason };
  }
  const { wideRun, sizeSamples, runs, rank, ...rest } = out;
  return { ...rest, span: rest.span.map((s) => s / N) };
}

function fitProfile(ev: Evidence, maxRun: number, compress: boolean, pxPerSample: number): AxisFit {
  const N = ev.edge.length;
  const { b, orig, isSep, pale, runs } = collapseSeparators(ev, maxRun, compress);
  const M = b.length;
  const none = {
    count: 1,
    score: 0,
    rank: 0,
    alt: null,
    altScore: 0,
    size: N * pxPerSample,
    sizeSamples: N,
    span: [0, N],
    reason: 'no borders',
  };
  if (M < 2 * MIN_CELL_PX) return none;
  // Evidence within r samples, discounted with distance so that among
  // sizes whose teeth all stay in reach the one that lands on the borders
  // wins (else the drift shows only as a missed border at the far end).
  const wins = [0, 1, 2, 3].map((r) =>
    b.map((v, i) => {
      let m = v;
      for (let d = 1; d <= r; d++) m = Math.max(m, (1 - (0.5 * d) / (r + 1)) * Math.max(b[i - d] || 0, b[i + d] || 0));
      return m;
    }),
  );
  const win = wins[1];
  // Cell sizes in steps fine enough that the comb drifts under a sample
  // across the whole axis.
  const minP = Math.max(MIN_CELL_PX / pxPerSample, M / MAX_CELLS, 2);
  const step = 1 + Math.min(0.004, 1.5 / M);
  // Clear borders only: faint noise everywhere would outweigh them.
  let total = 0;
  for (let i = 1; i < M - 1; i++) total += Number(b[i] >= 0.5);
  if (total < 2) return none;
  const fits: CombFit[] = [];
  for (let P = minP; P <= M / 1.5; P *= step) fits.push(combAt(wins, b, P, total));
  if (!fits.length) return none;
  // Local maxima over the cell size, best first.
  const peaks = fits.filter(
    (f, i) => f.score >= (fits[i - 1]?.score ?? -Infinity) && f.score >= (fits[i + 1]?.score ?? -Infinity),
  );
  const top = Math.max(...peaks.map((f) => f.score));
  if (top < MIN_FIT) return { ...none, score: Math.max(0, top), reason: 'weak borders' };
  const toOrig = (t: number) => {
    const i = Math.max(0, Math.min(M - 1, t));
    const k = Math.floor(i);
    const a = orig[k];
    const c = orig[Math.min(M - 1, k + 1)];
    return a + (i - k) * (c - a);
  };
  const describe = (f: CombFit) => {
    f = refineComb(f, b);
    const c = combCells(f, wins, isSep, pale);
    const span = [toOrig(c.start), toOrig(c.end)];
    return { ...f, count: c.count, span, white: c.white, fit: combFit(f, b) };
  };
  // The most cells among the near-best sizes (smallest P), at the size
  // that fits best near it: a size 0.1% off drifts 3 px over 30 rows.
  const P0 = Math.min(...peaks.filter((f) => f.score >= top - COUNT_TIE).map((f) => f.P));
  const chosen = describe(
    peaks.filter((f) => f.P >= P0 && f.P <= 1.05 * P0).reduce((a, f) => (f.score > a.score ? f : a)),
  );
  // The best different count, for the caller to weigh.
  let alt = null;
  for (const f of peaks
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)) {
    const d = describe(f);
    if (d.count !== chosen.count) {
      alt = d;
      break;
    }
  }
  const sizeSamples = (chosen.span[1] - chosen.span[0]) / chosen.count;
  const wideRun = runs.some(([a, c]) => c - a >= 0.5 * sizeSamples);
  let reason = 'clean';
  if (chosen.fit < 0.7) reason = 'weak fit';
  if (chosen.white) {
    reason = `${reason}; ${chosen.white} white end cell${chosen.white > 1 ? 's' : ''} left out`;
    alt = { count: chosen.count + chosen.white, fit: chosen.fit };
  }
  // Every other border much weaker than the rest: half as many cells, with
  // something (a dendrogram, tick marks) across their middles.
  if (chosen.count >= 4 && chosen.count % 2 === 0) {
    const tooth = (k: number) => wins[chosen.r][Math.round(chosen.phase + k * chosen.P)] ?? 0;
    let even = 0;
    let odd = 0;
    for (let k = 0; chosen.phase + k * chosen.P < M - 1; k++) k % 2 ? (odd += tooth(k)) : (even += tooth(k));
    if (Math.min(even, odd) < 0.5 * Math.max(even, odd)) {
      reason = 'every other border weak';
      alt = { count: chosen.count / 2, fit: alt?.count === chosen.count / 2 ? alt.fit : 0 };
    }
  }
  return {
    count: chosen.count,
    score: chosen.fit,
    rank: chosen.score,
    alt: alt ? alt.count : null,
    altScore: alt ? alt.fit : 0,
    size: sizeSamples * pxPerSample,
    sizeSamples,
    span: chosen.span,
    reason,
    wideRun: wideRun && maxRun === Infinity,
    runs: runs.length,
  };
}

// Cell counts of a placed grid from where its cell borders are. Returns
// {rows, cols, rowScore, colScore} (a score near 1 is a clean fit; below
// ~0.5 the borders are not evenly spaced or not visible), plus per axis
// the best different count and its score (rowAlt, rowAltScore), the cell
// size in pixels (rowSize), where the counted cells start and end along
// the axis as 0–1 of the box (rowSpan: [a, b]; far from [0, 1] means the
// corners include something else), and a short reason (rowReason).
export function fitCellCounts(img: PixelImage, corners: Corners) {
  const cols = fitAxis(img, corners, 'u');
  const rows = fitAxis(img, corners, 'v');
  return {
    rows: rows.count,
    cols: cols.count,
    rowScore: rows.score,
    colScore: cols.score,
    rowAlt: rows.alt,
    colAlt: cols.alt,
    rowAltScore: rows.altScore,
    colAltScore: cols.altScore,
    rowSize: rows.size,
    colSize: cols.size,
    rowSpan: rows.span,
    colSpan: cols.span,
    rowReason: rows.reason,
    colReason: cols.reason,
  };
}

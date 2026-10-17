import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupedFigure, makeImage, paintHeatmap, paintDots, setPixel, cmap, VIRIDISH } from '../helpers.js';
import CM from '../load.js';

const { rectCorners, bilinear, invertBilinear, cellAt, sampleCell, readPixel, detectGridSize } = CM;

const close = (a, b, eps) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const skewed = [{ x: 10, y: 12 }, { x: 110, y: 20 }, { x: 104, y: 220 }, { x: 4, y: 210 }];

test('rectCorners orders corners TL, TR, BR, BL', () => {
  assert.deepEqual(rectCorners({ x: 50, y: 5 }, { x: 10, y: 40 }), [
    { x: 10, y: 5 }, { x: 50, y: 5 }, { x: 50, y: 40 }, { x: 10, y: 40 },
  ]);
});

test('invertBilinear inverts bilinear on a skewed quad', () => {
  for (const [u, v] of [[0.1, 0.2], [0.5, 0.5], [0.93, 0.71]]) {
    const r = invertBilinear(skewed, bilinear(skewed, u, v));
    close(r.u, u, 1e-6);
    close(r.v, v, 1e-6);
  }
});

test('cellAt finds the cell and rejects outside points', () => {
  const grid = { corners: rectCorners({ x: 0, y: 0 }, { x: 100, y: 80 }), rows: 4, cols: 5 };
  assert.deepEqual(cellAt(grid, { x: 45, y: 70 }), { row: 3, col: 2 });
  assert.equal(cellAt(grid, { x: 120, y: 10 }), null);
});

test('readPixel composites transparency on white', () => {
  const img = makeImage(1, 1, [0, 0, 0, 0]);
  assert.deepEqual(readPixel(img, 0, 0), [255, 255, 255]);
});

test('sampleCell median ignores sparse outliers', () => {
  const img = makeImage(20, 20, [10, 20, 30, 255]);
  // Sprinkle a few bright outlier pixels inside the sampled area.
  for (const [x, y] of [[8, 8], [9, 10], [11, 9]]) img.data.set([255, 255, 255, 255], (y * 20 + x) * 4);
  const grid = { corners: rectCorners({ x: 0, y: 0 }, { x: 20, y: 20 }), rows: 1, cols: 1, sampleFraction: 0.5 };
  assert.deepEqual(sampleCell(img, grid, 0, 0), [10, 20, 30]);
});

function randomMatrix(rows, cols, seed = 7) {
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => rand()));
}

function detectCase(rows, cols, corners, { lines = true, matrix, offset = 0, size = [260, 380] } = {}) {
  const img = makeImage(...size);
  paintHeatmap(img, corners, matrix || randomMatrix(rows, cols), VIRIDISH, { lines });
  const placed = corners.map((c, i) => ({ x: c.x + (i === 0 || i === 3 ? -offset : offset), y: c.y + (i < 2 ? -offset : offset) }));
  return detectGridSize(img, placed);
}

test('detectGridSize finds common heatmap shapes', () => {
  for (const [rows, cols] of [[16, 4], [8, 4], [13, 3], [5, 12]]) {
    const r = detectCase(rows, cols, rectCorners({ x: 20, y: 20 }, { x: 220, y: 340 }));
    assert.deepEqual([r.rows, r.cols], [rows, cols], `${rows}x${cols}`);
  }
});

test('detectGridSize works without grid lines and on skewed grids', () => {
  const r1 = detectCase(13, 4, rectCorners({ x: 20, y: 20 }, { x: 180, y: 320 }), { lines: false });
  assert.deepEqual([r1.rows, r1.cols], [13, 4]);
  const skew = [{ x: 22, y: 18 }, { x: 205, y: 30 }, { x: 196, y: 350 }, { x: 12, y: 338 }];
  const r2 = detectCase(10, 5, skew, { lines: false });
  assert.deepEqual([r2.rows, r2.cols], [10, 5]);
});

test('detectGridSize tolerates corners placed a few pixels off', () => {
  for (const offset of [-2, 2]) {
    const r = detectCase(16, 4, rectCorners({ x: 20, y: 20 }, { x: 220, y: 340 }), { offset });
    assert.deepEqual([r.rows, r.cols], [16, 4], `offset ${offset}`);
  }
});

test('detectGridSize copes with runs of identical cells', () => {
  const m = randomMatrix(16, 4);
  for (const r of [2, 3, 4, 5, 11]) m[r][0] = 0; // like the white A column in the example
  m[7] = [0.5, 0.5, 0.5, 0.5];
  const r = detectCase(16, 4, rectCorners({ x: 20, y: 20 }, { x: 220, y: 340 }), { matrix: m, lines: false });
  assert.deepEqual([r.rows, r.cols], [16, 4]);
});

test('detectGridSize returns 1 x 1 for a flat block', () => {
  const r = detectCase(1, 1, rectCorners({ x: 20, y: 20 }, { x: 220, y: 340 }), { matrix: [[0.4]], lines: false });
  assert.deepEqual([r.rows, r.cols], [1, 1]);
});

test('outerCorners extrapolates half a cell beyond the corner dot centers, and back', () => {
  const { outerCorners, cornerCellCenters } = CM;
  const grid = { anchor: 'centers', corners: rectCorners({ x: 20, y: 10 }, { x: 80, y: 50 }), rows: 3, cols: 4 };
  // Spacing 20 px across, 20 px down.
  outerCorners(grid).forEach((p, i) => {
    const want = rectCorners({ x: 10, y: 0 }, { x: 90, y: 60 })[i];
    close(p.x, want.x, 1e-9);
    close(p.y, want.y, 1e-9);
  });
  const back = cornerCellCenters(outerCorners(grid), 3, 4);
  back.forEach((p, i) => (close(p.x, grid.corners[i].x, 1e-9), close(p.y, grid.corners[i].y, 1e-9)));
  assert.equal(outerCorners({ ...grid, anchor: 'corners' }), grid.corners);
});

test('circle sampling reads a disc inside its cell', () => {
  // A 20 × 20 cell with a red disc of radius 7 on white.
  const img = makeImage(20, 20);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) if ((x + 0.5 - 10) ** 2 + (y + 0.5 - 10) ** 2 <= 49) img.data.set([200, 0, 0, 255], (y * 20 + x) * 4);
  const grid = { corners: rectCorners({ x: 0, y: 0 }, { x: 20, y: 20 }), rows: 1, cols: 1, sampleFraction: 0.75 };
  // A 15 px square around a radius-7 disc is about 31 % white per channel; a 15 px circle is about 13 %.
  assert.deepEqual(sampleCell(img, { ...grid, shape: 'circle' }, 0, 0), [200, 0, 0]);
});

test('dotRadius finds each dot size and no dot in an empty cell', () => {
  const { dotRadius } = CM;
  const img = makeImage(160, 100);
  const radii = [[3, 6, 9, 0], [3, 6, 9, 0]];
  paintDots(img, { x: 20, y: 30 }, { x: 140, y: 70 }, [[0.2, 0.5, 0.8, 0.5], [0.2, 0.5, 0.8, 0.5]], radii, VIRIDISH);
  const grid = { anchor: 'centers', corners: rectCorners({ x: 20, y: 30 }, { x: 140, y: 30 + 40 }), rows: 2, cols: 4, sampleFraction: 0.7 };
  for (let c = 0; c < 3; c++) close(dotRadius(img, grid, 0, c), radii[0][c], 1.01);
  assert.equal(dotRadius(img, grid, 0, 3), null);
});

test('fitCellCounts counts groups of similar cells cell by cell', () => {
  // 5 rows × 12 columns in 3 groups of 4 nearly equal replicates.
  const matrix = Array.from({ length: 5 }, (_, r) => Array.from({ length: 12 }, (_, c) => 0.1 + 0.35 * Math.floor(c / 4) + 0.02 * (c % 4) + 0.03 * r));
  const img = makeImage(300, 160);
  const corners = [{ x: 12, y: 20 }, { x: 288, y: 20 }, { x: 288, y: 140 }, { x: 12, y: 140 }];
  paintHeatmap(img, corners, matrix, VIRIDISH, { lines: false });
  const fit = CM.fitCellCounts(img, corners);
  assert.deepEqual([fit.rows, fit.cols], [5, 12]);
  assert.ok(fit.colScore > 0.7 && fit.rowScore > 0.7);
});

test('fitCellCounts takes the full count when coarser counts fit as well', () => {
  // Every border strong: 4 columns (every third border) also fit perfectly.
  const matrix = Array.from({ length: 9 }, (_, r) => Array.from({ length: 12 }, (_, c) => ((r * 5 + c * 7) % 11) / 10));
  const img = makeImage(300, 260);
  const corners = [{ x: 10, y: 10 }, { x: 250, y: 10 }, { x: 250, y: 190 }, { x: 10, y: 190 }];
  paintHeatmap(img, corners, matrix, VIRIDISH, { lines: false });
  const fit = CM.fitCellCounts(img, corners);
  assert.deepEqual([fit.rows, fit.cols], [9, 12]);
});

test('fitCellCounts fits groups of columns split by white gaps one by one', () => {
  // 8 groups of 4 columns, 8 px gaps, 2 px lines: the gaps shift the cells
  // off one even spacing (that fit scored 0.77; detectGridSize says 3).
  const { img, cells } = groupedFigure();
  const fit = CM.fitCellCounts(img, [{ x: cells.x0, y: cells.y0 }, { x: cells.x1, y: cells.y0 }, { x: cells.x1, y: cells.y1 }, { x: cells.x0, y: cells.y1 }]);
  assert.deepEqual([fit.rows, fit.cols], [12, 32]);
  assert.ok(fit.colScore > 0.85, `colScore ${fit.colScore}`);
});

test('fitCellCounts does not take a column of white cells for a gap', () => {
  const matrix = Array.from({ length: 6 }, (_, r) => Array.from({ length: 8 }, (_, c) => ((r * 5 + c * 3) % 7) / 6));
  const img = makeImage(300, 200);
  const corners = [{ x: 20, y: 20 }, { x: 260, y: 20 }, { x: 260, y: 170 }, { x: 20, y: 170 }];
  paintHeatmap(img, corners, matrix, VIRIDISH);
  for (let y = 20; y < 170; y++) for (let x = 110; x < 140; x++) img.data.set([255, 255, 255, 255], (y * 300 + x) * 4);
  assert.equal(CM.fitCellCounts(img, corners).cols, 8);
});

// ---- fitCellCounts on rough boxes (cases from 14 real figures) ----------------

const box = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const grow = ([x0, y0, x1, y1], [l, t, r, b]) => box(x0 - l, y0 - t, x1 + r, y1 + b);
const fill = (img, x0, y0, x1, y1, rgb) => {
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++) setPixel(img, x, y, rgb);
};
const frame = (img, [x0, y0, x1, y1], w, rgb = [20, 20, 20]) => {
  fill(img, x0 - w, y0 - w, x1 + w, y0, rgb);
  fill(img, x0 - w, y1, x1 + w, y1 + w, rgb);
  fill(img, x0 - w, y0, x0, y1, rgb);
  fill(img, x1, y0, x1 + w, y1, rgb);
};
// Cells of `cw` × `ch` px with `gap` px of `gapRgb` between them, starting at
// (x0, y0); returns the cell block [x0, y0, x1, y1].
function paintCells(img, x0, y0, rows, cols, cw, ch, gap, colorAt, gapRgb = [255, 255, 255]) {
  const x1 = x0 + cols * cw + (cols - 1) * gap;
  const y1 = y0 + rows * ch + (rows - 1) * gap;
  fill(img, x0, y0, x1, y1, gapRgb);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * (cw + gap);
      const y = y0 + r * (ch + gap);
      fill(img, x, y, x + cw, y + ch, colorAt(r, c));
    }
  return [x0, y0, x1, y1];
}
const rand = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const viridis = (next) => () => cmap(VIRIDISH, next());
// Seeded JPEG-like noise of ±amp per channel.
function addNoise(img, amp, seed = 3) {
  const next = rand(seed);
  for (let i = 0; i < img.data.length; i += 4) for (let k = 0; k < 3; k++) img.data[i + k] += Math.round((next() * 2 - 1) * amp);
}
const counts = (img, corners) => {
  const f = CM.fitCellCounts(img, corners);
  return [f.rows, f.cols];
};

test('fitCellCounts counts a white gap between cells once (5 × 5 cells, 8 px gaps, framed)', () => {
  // Each gap gave two edges: 10 × 10.
  const img = makeImage(700, 700);
  const color = viridis(rand(5));
  const cells = paintCells(img, 60, 60, 5, 5, 104, 104, 8, () => color());
  frame(img, cells, 5);
  for (const pad of [[0, 0, 0, 0], [5, 5, 5, 5], [9, 9, 9, 9], [-4, -4, -4, -4], [8, -3, 2, 6]]) assert.deepEqual(counts(img, grow(cells, pad)), [5, 5], `pad ${pad}`);
  const f = CM.fitCellCounts(img, box(...cells));
  assert.ok(f.rowScore > 0.7 && f.colScore > 0.7, `scores ${f.rowScore} ${f.colScore}`);
});

test('fitCellCounts ignores a frame and margin inside a rough box (40 rows, 2 px lines, JPEG noise)', () => {
  // A 7 px frame on 37 px rows gave 339 rows, a 4 px corner shift 40 → 2.
  const img = makeImage(640, 1500);
  const color = viridis(rand(9));
  const cells = paintCells(img, 60, 40, 40, 13, 36, 32, 2, () => color());
  frame(img, cells, 6);
  addNoise(img, 6);
  for (const pad of [[0, 0, 0, 0], [7, 7, 7, 7], [4, -4, 4, -4], [-4, 4, -4, 4], [12, 10, 3, 14], [-6, 6, 6, -6]]) assert.deepEqual(counts(img, grow(cells, pad)), [40, 13], `pad ${pad}`);
});

test('fitCellCounts reports where the cells are inside a too large box', () => {
  const img = makeImage(500, 400);
  const color = viridis(rand(2));
  const cells = paintCells(img, 80, 60, 6, 8, 38, 40, 0, () => color());
  frame(img, cells, 2);
  const f = CM.fitCellCounts(img, grow(cells, [15, 15, 15, 15]));
  assert.deepEqual([f.rows, f.cols], [6, 8]);
  // The box spans 334 px across; the cells 304 px from 15 px in.
  close(f.colSpan[0] * 334, 15, 4);
  close(f.colSpan[1] * 334, 319, 4);
  close(f.colSize, 38, 1);
});

test('fitCellCounts does not double rows for a dendrogram touching their middles', () => {
  // A dendrogram's leaf ticks at the row middles (on 3% of the lines) gave
  // 60 rows for 30 and 42 for 21.
  const img = makeImage(700, 760);
  const color = viridis(rand(4));
  const cells = paintCells(img, 120, 30, 30, 20, 26, 22, 1, () => color(), [60, 60, 60]);
  for (let r = 0; r < 30; r++) fill(img, 90, 30 + r * 23 + 10, 120, 30 + r * 23 + 12, [0, 0, 0]);
  fill(img, 90, 30, 92, cells[3], [0, 0, 0]);
  for (const pad of [[0, 0, 0, 0], [30, 0, 0, 0], [24, 4, -3, 5]]) assert.deepEqual(counts(img, grow(cells, pad)), [30, 20], `pad ${pad}`);
});

test('fitCellCounts tolerates tick marks outside the frame in the box (27 × 27)', () => {
  // A comb of tick marks 20 px past the frame gave 55 × 55.
  const img = makeImage(900, 900);
  const color = viridis(rand(8));
  const cells = paintCells(img, 60, 40, 27, 27, 28, 28, 0, () => color());
  frame(img, cells, 2);
  for (let k = 0; k < 27; k++) {
    fill(img, 40, 40 + k * 28 + 13, 58, 40 + k * 28 + 15, [0, 0, 0]);
    fill(img, 60 + k * 28 + 13, cells[3] + 2, 60 + k * 28 + 15, cells[3] + 20, [0, 0, 0]);
  }
  for (const pad of [[0, 0, 0, 0], [20, 2, 2, 20], [6, 6, 6, 6], [-6, 6, -6, 6]]) assert.deepEqual(counts(img, grow(cells, pad)), [27, 27], `pad ${pad}`);
});

test('fitCellCounts finds replicate columns without lines between them', () => {
  // 3 groups of 3 replicates, neighbouring replicates 16–23 levels apart and
  // equal on some rows; the old fit said 3 columns.
  const img = makeImage(760, 700);
  const next = rand(6);
  const base = Array.from({ length: 32 }, () => Array.from({ length: 3 }, () => cmap(VIRIDISH, next())));
  const cells = paintCells(img, 40, 40, 32, 9, 74, 19, 0, (r, c) => {
    const d = r % 3 === 0 ? 0 : [0, 8, -7][c % 3];
    return base[r][Math.floor(c / 3)].map((v) => Math.max(0, Math.min(255, v + d)));
  });
  frame(img, cells, 1);
  const f = CM.fitCellCounts(img, box(...cells));
  assert.deepEqual([f.rows, f.cols], [32, 9]);
});

test('fitCellCounts keeps a framed row of white cells at the end', () => {
  // Zeros on a diverging map are white: a white first row inside the frame
  // is a row of cells, a white band outside it is margin.
  const img = makeImage(400, 420);
  const color = viridis(rand(1));
  const cells = paintCells(img, 40, 40, 10, 6, 50, 34, 0, (r) => (r === 0 ? [255, 255, 255] : color()));
  frame(img, cells, 2);
  for (const pad of [[2, 2, 2, 2], [4, 4, 4, 4], [10, 10, 10, 10]]) assert.deepEqual(counts(img, grow(cells, pad)), [10, 6], `pad ${pad}`);
  // Without the frame in the box it could be margin: left out, but offered.
  const f = CM.fitCellCounts(img, box(...cells));
  assert.deepEqual([f.rows, f.rowAlt], [9, 10]);
  assert.match(f.rowReason, /white end cell/);
});

test('fitCellCounts gives a low score where no borders can be seen', () => {
  // A smooth strip without cell borders cannot be counted from its pixels.
  const img = makeImage(600, 120);
  for (let x = 20; x < 580; x++) fill(img, x, 30, x + 1, 80, cmap(VIRIDISH, (x - 20) / 560));
  const f = CM.fitCellCounts(img, box(20, 30, 580, 80));
  assert.ok(f.colScore < 0.5, `colScore ${f.colScore}`);
});

test('fitCellCounts and detectGridSize see through numbers printed in framed cells', () => {
  // Test-18: the strokes of one-decimal values in 5 rows of framed cells gave
  // 10 rows (fit) and 10 (detectGridSize). Cells at x 20–616, y 20–316.
  const img = makeImage(700, 380);
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 10; c++) {
      const [x, y] = [20 + c * 60, 20 + r * 60];
      const k = (r * 3 + c * 7) % 5;
      fill(img, x, y, x + 56, y + 56, [40, 40, 40]);
      fill(img, x + 2, y + 2, x + 54, y + 54, c < 2 ? [253, 249 - 3 * k, 242 - 6 * k] : [236 - 5 * k, 180 - 12 * k, 110 - 12 * k]);
      for (let g = 0; g < 3; g++) {
        const [gx, gy] = [x + 13 + g * 11, y + 22];
        for (const [a, b, e, d] of [[0, 0, 8, 2], [0, 6, 8, 8], [0, 12, 8, 14], [0, 0, 2, 14], [6, 0, 8, 14]]) fill(img, gx + a, gy + b, gx + e, gy + d, [30, 30, 30]);
      }
    }
  for (const b of [box(20, 20, 616, 316), box(16, 14, 622, 320), box(24, 26, 610, 312)]) assert.deepEqual(counts(img, b), [5, 10]);
  const d = detectGridSize(img, box(20, 20, 616, 316));
  assert.deepEqual([d.rows, d.cols], [5, 10]);
});

test('suppressText paints over short dark dips and keeps lines dark on every line', () => {
  // 4 lines × 30 samples: a 3-sample dark stroke on line 1, a dark column at
  // sample 20 on every line (a grid line).
  const N = 30;
  const rgb = new Float32Array(4 * N * 3).fill(200);
  const set = (j, i, v) => rgb.fill(v, (j * N + i) * 3, (j * N + i) * 3 + 3);
  for (const i of [8, 9, 10]) set(1, i, 20);
  for (let j = 0; j < 4; j++) set(j, 20, 20);
  const share = CM.suppressText(rgb, N, 4);
  assert.ok(share > 0);
  assert.equal(rgb[(1 * N + 9) * 3], 200);
  for (let j = 0; j < 4; j++) assert.equal(rgb[(j * N + 20) * 3], 20);
});

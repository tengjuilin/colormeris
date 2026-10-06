import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeImage, paintHeatmap, paintDots, VIRIDISH } from '../helpers.js';
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

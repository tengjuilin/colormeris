import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeImage, setPixel, paintHeatmap, paintColorbar, VIRIDISH } from '../helpers.js';
import CM from '../load.js';

const { snapBlock, findTickLabels } = CM;

const fill = (img, x0, y0, x1, y1, rgb = [20, 20, 20]) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) setPixel(img, x, y, rgb);
};
// A text-like label: `n` character blocks 6 px wide, 10 px tall, 2 px apart.
const label = (img, x, y, n = 3) => {
  for (let i = 0; i < n; i++) fill(img, x + i * 8, y, x + i * 8 + 6, y + 10);
};
const matrix = (rows, cols) => Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ((r * 7 + c * 3) % 10) / 9));
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

// Heatmap cells at x 60–220, y 40–160 with row labels on the left and a
// colorbar on the right.
function figure() {
  const img = makeImage(320, 220);
  paintHeatmap(img, rect(60, 40, 220, 160), matrix(6, 8), VIRIDISH, { lines: false });
  for (let r = 0; r < 6; r++) label(img, 20, 45 + r * 20, 4);
  paintColorbar(img, 240, 255, 40, 159, VIRIDISH);
  return img;
}

test('snapBlock moves a rough box onto the block of cells', () => {
  const img = figure();
  // Off by 10–15 px on every side, reaching into the labels and the colorbar.
  const b = snapBlock(img, { x0: 25, y0: 55, x1: 245, y1: 175 });
  assert.deepEqual(b, { x0: 60, y0: 40, x1: 220, y1: 160 });
});

test('snapBlock bridges white lines between cells', () => {
  const img = makeImage(300, 200);
  paintHeatmap(img, rect(50, 30, 250, 170), matrix(5, 6), VIRIDISH, { lines: false });
  fill(img, 148, 30, 152, 170, [255, 255, 255]);
  assert.deepEqual(snapBlock(img, { x0: 60, y0: 40, x1: 240, y1: 160 }), { x0: 50, y0: 30, x1: 250, y1: 170 });
});

test('snapBlock finds the background when a neighbour crosses the window', () => {
  const img = makeImage(300, 320);
  paintHeatmap(img, rect(20, 0, 280, 70), matrix(3, 8), VIRIDISH, { lines: false });
  paintHeatmap(img, rect(80, 110, 220, 300), matrix(8, 5), VIRIDISH, { lines: false });
  assert.deepEqual(snapBlock(img, { x0: 90, y0: 120, x1: 230, y1: 290 }), { x0: 80, y0: 110, x1: 220, y1: 300 });
});

test('snapBlock returns null on an empty area', () => {
  assert.equal(snapBlock(makeImage(100, 100), { x0: 20, y0: 20, x1: 80, y1: 80 }), null);
});

test('findTickLabels finds labels beside a vertical bar in reading order', () => {
  const img = makeImage(200, 260);
  paintColorbar(img, 40, 59, 30, 229, VIRIDISH);
  for (const y of [30, 130, 229]) fill(img, 60, y, 66, y + 1); // tick marks
  for (const y of [30, 130, 229]) label(img, 72, y - 5); // centred on the ticks
  for (let i = 0; i < 6; i++) fill(img, 150, 80 + i * 14, 160, 90 + i * 14); // rotated title further out
  const { side, marks } = findTickLabels(img, { x0: 40, y0: 30, x1: 60, y1: 230 });
  assert.equal(side, 'right');
  assert.deepEqual(marks.map((m) => m.at), [{ x: 50, y: 30 }, { x: 50, y: 130 }, { x: 50, y: 229 }]);
  assert.deepEqual(marks[0].box, { x0: 72, y0: 25, x1: 94, y1: 35 });
});

test('findTickLabels reads a horizontal bar left to right, labels below', () => {
  const img = makeImage(300, 120);
  for (let x = 40; x < 260; x++) for (let y = 20; y < 36; y++) setPixel(img, x, y, VIRIDISH[Math.floor(((x - 40) / 220) * 4.99)]);
  for (const x of [40, 150, 259]) label(img, x - 11, 44); // "0.0", "0.5", "1.0" centred on x
  const { side, marks } = findTickLabels(img, { x0: 40, y0: 20, x1: 260, y1: 36 });
  assert.equal(side, 'below');
  assert.deepEqual(marks.map((m) => m.at.x), [40, 150, 259]);
  assert.ok(marks.every((m) => m.at.y === 28));
});

test('snapBlock follows a block past a box that cut it short', () => {
  const img = makeImage(200, 400);
  paintHeatmap(img, rect(40, 20, 160, 380), matrix(12, 4), VIRIDISH, { lines: false });
  // The box covers only the top quarter: the window would end at y 147.
  assert.deepEqual(snapBlock(img, { x0: 45, y0: 25, x1: 155, y1: 110 }), { x0: 40, y0: 20, x1: 160, y1: 380 });
});

test('labelReach stops at the white gap before the next panel', () => {
  const img = figure();
  // Row labels at x 20–51; another panel's colorbar further left.
  fill(img, 0, 40, 3, 160, [200, 120, 30]);
  assert.equal(CM.labelReach(img, { x0: 60, y0: 40, x1: 220, y1: 160 }, 'left', 100), 20);
  assert.equal(CM.labelReach(img, { x0: 60, y0: 40, x1: 220, y1: 160 }, 'below', 50), 160);
});

test('snapBlock grows over pale cells of a colormap that starts at white', () => {
  // Blues-like: white (255, 255, 255) to dark blue. The left column is white
  // except two pale cells, so it never fills 75% of a line.
  const BLUES = [[255, 255, 255], [198, 219, 239], [107, 174, 214], [33, 113, 181], [8, 48, 107]];
  const m = matrix(8, 4).map((row, r) => row.map((v, c) => (c === 0 ? (r === 2 ? 0.04 : r === 6 ? 0.08 : 0) : 0.3 + 0.7 * v)));
  const img = makeImage(260, 220);
  paintHeatmap(img, rect(60, 20, 220, 180), m, BLUES, { lines: false });
  for (let r = 0; r < 8; r++) label(img, 20, 25 + r * 20, 3); // row labels, 9 px from the cells
  assert.deepEqual(snapBlock(img, { x0: 100, y0: 30, x1: 215, y1: 170 }), { x0: 60, y0: 20, x1: 220, y1: 180 });
});

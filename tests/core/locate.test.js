import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeImage, setPixel, paintHeatmap, paintColorbar, VIRIDISH, groupedFigure } from '../helpers.js';
import CM from '../load.js';

const { snapBlock, findStrip, findTickLabels, besideBox, besideCheck } = CM;

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

test('labelReach takes a wider gap beside a large heatmap', () => {
  // 1500 px of cells, legend boxes 12 px left of them, their row labels 24 px
  // further left: 2% of the width (30 px) bridges that gap.
  const img = makeImage(1700, 200);
  fill(img, 150, 40, 1650, 160, [240, 200, 200]);
  for (let i = 0; i < 4; i++) fill(img, 120, 45 + i * 25, 138, 63 + i * 25);
  for (let i = 0; i < 4; i++) label(img, 50, 48 + i * 25, 6);
  assert.equal(CM.labelReach(img, { x0: 150, y0: 40, x1: 1650, y1: 160 }, 'left', 300), 50);
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

test('snapBlock finds pale diverging cells and crosses a frame around them', () => {
  // Most cells within 30 levels of white, a pale first row 7 levels off, and
  // a pure-white row inside a 2 px gray frame; a colorbar 15 px below must
  // not be taken in, even from a box on the top half only.
  const img = makeImage(300, 260);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 6; c++) {
    const d = r === 0 ? 7 : r === 6 ? 0 : 10 + ((r * 5 + c * 3) % 20);
    fill(img, 50 + c * 30, 30 + r * 20, 80 + c * 30, 50 + r * 20, [255 - (c % 2 ? d : 0), 255 - d, 255 - (c % 2 ? 0 : d)]);
  }
  fill(img, 48, 28, 232, 30, [126, 126, 126]);
  fill(img, 48, 190, 232, 192, [126, 126, 126]);
  fill(img, 48, 28, 50, 192, [126, 126, 126]);
  fill(img, 230, 28, 232, 192, [126, 126, 126]);
  paintColorbar(img, 50, 230, 207, 222, VIRIDISH);
  for (const box of [{ x0: 60, y0: 40, x1: 220, y1: 180 }, { x0: 60, y0: 40, x1: 220, y1: 130 }]) assert.deepEqual(snapBlock(img, box), { x0: 48, y0: 28, x1: 232, y1: 192 });
});

test('findStrip finds a colorbar beside the cells without a box', () => {
  const img = figure();
  // The page right of the cells: labels are dark, only the strip is colored.
  assert.deepEqual(findStrip(img, { x0: 225, y0: 0, x1: 320, y1: 220 }), { x0: 240, y0: 40, x1: 256, y1: 160 });
});

test('snapBlock crosses white lines and gaps between groups of pale cells', () => {
  // Only rows 4–8 of groups 3–6 are 40 levels off white; every line between
  // cells is pure white, as in a screenshot. The block used to stop at the
  // first white line around that dark core (one row, 12 of 32 columns).
  // Brackets and label underlines 8 px away (as wide as a group gap) stay out.
  const { img, cells } = groupedFigure();
  for (const box of [
    { x0: cells.x0 + 15, y0: cells.y0 - 12, x1: cells.x1 - 10, y1: cells.y1 + 14 },
    { x0: cells.x0 - 20, y0: cells.y0 + 10, x1: cells.x1 + 20, y1: cells.y1 - 10 },
    { x0: cells.x0 + 75, y0: cells.y0 + 24, x1: cells.x1 - 75, y1: cells.y1 - 24 },
  ])
    assert.deepEqual(snapBlock(img, box), cells);
});

test('a horizontal colorbar below grouped cells is found with its tick labels', () => {
  // Left of it a title, right of it empty legend boxes with their labels.
  const { img, cells, bar, ticks } = groupedFigure();
  const found = findStrip(img, besideBox(cells, 'below', img.width, img.height));
  assert.deepEqual(found, bar);
  const labels = findTickLabels(img, found);
  assert.equal(labels.side, 'below');
  assert.equal(labels.marks.length, 4);
  labels.marks.forEach((m, i) => assert.ok(Math.abs(m.at.x - ticks[i]) <= 2, `label ${i + 1} at ${m.at.x}, tick at ${ticks[i]}`));
  assert.ok(besideCheck(cells, found, 'below', labels.side));
});

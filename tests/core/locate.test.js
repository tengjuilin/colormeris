import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeImage, setPixel, paintHeatmap, paintColorbar, cmap, VIRIDISH, groupedFigure } from '../helpers.js';
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

// Real figures are blurred (JPEG, resampling): a 3 × 3 box blur.
const blur = (img) => {
  const src = new Uint8ClampedArray(img.data);
  const { width: W, height: H } = img;
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++)
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += src[((y + dy) * W + x + dx) * 4 + k];
        img.data[(y * W + x) * 4 + k] = Math.round(s / 9);
      }
  return img;
};
// JPEG-like ringing: ±8 levels (a fixed pseudo-random sequence) on every
// pixel that is not clean page, so a thin white gap is no longer blank.
const noise = (img) => {
  const d = img.data;
  let seed = 7;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] >= 252 && d[i + 1] >= 252 && d[i + 2] >= 252) continue;
    for (let k = 0; k < 3; k++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      d[i + k] += (seed % 17) - 8;
    }
  }
  return img;
};
const outline = (img, x0, y0, x1, y1, w = 1, rgb = [20, 20, 20]) => {
  fill(img, x0, y0, x1, y0 + w, rgb);
  fill(img, x0, y1 - w, x1, y1, rgb);
  fill(img, x0, y0, x0 + w, y1, rgb);
  fill(img, x1 - w, y0, x1, y1, rgb);
};
// Cells of `m` in a grid with white lines `line` px wide between them.
const gridCells = (img, x0, y0, rows, cols, size, line, stops, m = matrix(rows, cols)) => {
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * (size + line);
      const y = y0 + r * (size + line);
      paintHeatmap(img, rect(x, y, x + size, y + size), [[m[r][c]]], stops, { lines: false });
    }
};
const near = (a, b, tol = 2) => ['x0', 'y0', 'x1', 'y1'].every((k) => Math.abs(a[k] - b[k]) <= tol);
const RDBU = [[5, 48, 97], [67, 147, 195], [247, 247, 247], [214, 96, 77], [103, 0, 31]];

test('snapBlock stops at a blurred frame with a colorbar right beside it', () => {
  // Test-2: 5 × 5 cells with 5 px white lines in a 4 px frame; a colorbar
  // 80% as tall as the cells, 4 px past the frame. Blurred and noisy, the
  // gap looked like the white lines between cells, and the bands of the
  // colorbar like more cells.
  const img = makeImage(400, 300);
  gridCells(img, 44, 34, 5, 5, 40, 5, RDBU);
  outline(img, 40, 30, 268, 258, 4);
  paintColorbar(img, 273, 293, 58, 210, RDBU);
  outline(img, 272, 57, 295, 212, 1);
  noise(blur(blur(img)));
  for (const box of [{ x0: 50, y0: 40, x1: 258, y1: 248 }, { x0: 30, y0: 25, x1: 290, y1: 265 }, { x0: 70, y0: 60, x1: 240, y1: 230 }]) {
    const b = snapBlock(img, box);
    assert.ok(near(b, { x0: 41, y0: 31, x1: 267, y1: 257 }), JSON.stringify(b));
  }
});

test('snapBlock leaves out a dendrogram, tick marks and a group strip', () => {
  // Test-6/9/11/7: leaf lines of a dendrogram touch the first column, a
  // comb of tick marks sits under the frame, and a solid two-color group
  // strip 3 px above the cells (bordered cells, so the strip has no grid).
  const img = makeImage(420, 360);
  const X0 = 100;
  const Y0 = 80;
  paintHeatmap(img, rect(X0, Y0, X0 + 240, Y0 + 200), matrix(8, 6), RDBU);
  outline(img, X0, Y0, X0 + 240, Y0 + 200, 2, [40, 40, 40]);
  for (let r = 0; r < 8; r++) fill(img, X0 - 30, Y0 + 11 + r * 25, X0, Y0 + 14 + r * 25, [60, 60, 60]); // leaves
  for (let k = 0; k < 4; k++) fill(img, X0 - 30 + k * 6, Y0 + 12 + k * 40, X0 - 28 + k * 6, Y0 + 40 + k * 40, [60, 60, 60]); // spines
  for (let c = 0; c < 6; c++) fill(img, X0 + 19 + c * 40, Y0 + 202, X0 + 21 + c * 40, Y0 + 222, [60, 60, 60]); // tick comb
  fill(img, X0, Y0 - 33, X0 + 120, Y0 - 3, [27, 158, 119]); // group strip
  fill(img, X0 + 120, Y0 - 33, X0 + 240, Y0 - 3, [217, 95, 2]);
  blur(img);
  for (const box of [{ x0: X0, y0: Y0, x1: X0 + 240, y1: Y0 + 200 }, { x0: X0 - 20, y0: Y0 - 20, x1: X0 + 250, y1: Y0 + 215 }]) {
    const b = snapBlock(img, box);
    assert.ok(near(b, { x0: X0, y0: Y0, x1: X0 + 240, y1: Y0 + 200 }), JSON.stringify(b));
  }
});

test('snapBlock keeps row labels and rotated text out of pale cells', () => {
  // Test-4/10: label text 14 px left of pale cells with 1 px black borders
  // (white cells among them) and rotated labels below them; sharp, then
  // blurred and noisy.
  for (const smudge of [(img) => img, (img) => noise(blur(blur(img)))]) {
    const img = makeImage(400, 360);
    const pale = [[255, 255, 255], [250, 220, 215], [215, 230, 245]];
    paintHeatmap(img, rect(100, 40, 340, 240), matrix(8, 6), pale);
    outline(img, 100, 40, 340, 240, 1, [0, 0, 0]);
    for (let r = 0; r < 8; r++) label(img, 50, 47 + r * 25, 5);
    for (let c = 0; c < 6; c++) for (let i = 0; i < 6; i++) fill(img, 115 + c * 40, 250 + i * 8, 125 + c * 40, 256 + i * 8);
    smudge(img);
    const b = snapBlock(img, { x0: 90, y0: 30, x1: 345, y1: 250 });
    assert.ok(near(b, { x0: 100, y0: 40, x1: 340, y1: 240 }), JSON.stringify(b));
  }
});

test('snapBlock puts the edges on the middle of a thick frame', () => {
  // Test-3: a 6 px frame around the cells; its middle is where a grid line
  // between cells would be.
  const img = makeImage(300, 260);
  paintHeatmap(img, rect(56, 36, 236, 216), matrix(6, 6), VIRIDISH, { lines: false });
  outline(img, 50, 30, 242, 222, 6, [10, 10, 10]);
  assert.deepEqual(snapBlock(img, { x0: 60, y0: 40, x1: 230, y1: 210 }), { x0: 52, y0: 32, x1: 240, y1: 220 });
});

test('snapEdges refines a trusted box without growing into a neighbour', () => {
  // Two blocks of cells 12 px apart, as test-1's groups: a box a few
  // pixels off each edge of the left one snaps to it, not to the right one.
  const img = makeImage(420, 200);
  gridCells(img, 40, 40, 3, 4, 36, 2, RDBU);
  gridCells(img, 202, 40, 3, 4, 36, 2, RDBU, matrix(3, 4).map((r) => r.map((v) => 1 - v)));
  const cells = { x0: 40, y0: 40, x1: 190, y1: 152 };
  assert.deepEqual(CM.snapEdges(img, { x0: 43, y0: 37, x1: 187, y1: 155 }), cells);
  assert.deepEqual(CM.snapEdges(img, { x0: 37, y0: 41, x1: 194, y1: 149 }), cells);
  // An edge in the middle of a cell, far from any cell edge, stays put;
  // snapBlock would take the whole block.
  assert.deepEqual(CM.snapEdges(img, { x0: 40, y0: 40, x1: 132, y1: 152 }), { x0: 40, y0: 40, x1: 132, y1: 152 });
  assert.deepEqual(snapBlock(img, { x0: 40, y0: 40, x1: 132, y1: 152 }), cells);
});

test('findStrip finds a whole diverging colorbar and a pale one with a white end', () => {
  // Test-9/11: a red-white-blue bar whose white middle split it; test-3/14:
  // a bar from white to pale purple inside a gray frame.
  // Each half of the diverging bar is under 3 times as long as it is thick.
  const img = makeImage(300, 300);
  paintColorbar(img, 40, 69, 40, 189, RDBU);
  const PALE = [[255, 255, 255], [230, 228, 245], [150, 140, 200]];
  paintColorbar(img, 200, 229, 40, 189, PALE);
  outline(img, 199, 39, 231, 191, 1, [90, 90, 90]);
  noise(blur(img));
  const a = findStrip(img, { x0: 20, y0: 0, x1: 120, y1: 300 });
  assert.ok(near(a, { x0: 40, y0: 40, x1: 70, y1: 190 }, 2), JSON.stringify(a));
  const b = findStrip(img, { x0: 150, y0: 0, x1: 300, y1: 300 });
  assert.ok(near(b, { x0: 200, y0: 40, x1: 230, y1: 190 }, 2), JSON.stringify(b));
});

test('findColorbars lists every colorbar on the page, cells left out', () => {
  // Test-10: two bars stacked at the right, one far from the cells, and a
  // categorical group strip beside the cells.
  const img = makeImage(500, 400);
  paintHeatmap(img, rect(60, 40, 300, 340), matrix(10, 8), RDBU, { lines: false });
  fill(img, 30, 40, 50, 140, [217, 95, 2]);
  fill(img, 30, 140, 50, 240, [117, 112, 179]);
  fill(img, 30, 240, 50, 340, [27, 158, 119]);
  paintColorbar(img, 400, 419, 40, 179, RDBU);
  paintColorbar(img, 400, 419, 230, 369, VIRIDISH);
  const bars = CM.findColorbars(img, { exclude: [{ x0: 60, y0: 40, x1: 300, y1: 340 }] });
  const boxes = bars.map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 }));
  assert.equal(bars.length, 3);
  assert.ok(boxes.some((b) => near(b, { x0: 400, y0: 40, x1: 420, y1: 180 })));
  assert.ok(boxes.some((b) => near(b, { x0: 400, y0: 230, x1: 420, y1: 370 })));
  assert.equal(bars.find((b) => b.x0 < 100).kind, 'categorical');
  assert.ok(bars.filter((b) => b.x0 > 100).every((b) => b.vertical && b.kind !== 'categorical'));
});

test('findTickLabels prefers tick labels to row labels and a rotated title', () => {
  // Test-12/10: big row labels and a rotated title between the cells and
  // the bar; 5 numbers on the far side.
  const img = makeImage(360, 300);
  paintColorbar(img, 200, 219, 40, 239, VIRIDISH);
  for (const y of [40, 90, 140, 190, 239]) label(img, 226, y - 5, 2);
  for (let r = 0; r < 9; r++) fill(img, 130, 20 + r * 32, 146, 42 + r * 32); // row labels, past the bar's ends too
  for (let i = 0; i < 10; i++) fill(img, 170, 80 + i * 12, 184, 90 + i * 12); // rotated title
  const { side, marks } = findTickLabels(img, { x0: 200, y0: 40, x1: 220, y1: 240 });
  assert.equal(side, 'right');
  assert.deepEqual(marks.map((m) => m.at.y), [40, 90, 140, 190, 239]);
});

test('findTickLabels takes labels facing the cells over a title beyond', () => {
  // Test-14: labels on the bar's left, tick marks inside the strip on
  // that side, and a rotated title of spaced characters on the right.
  const img = makeImage(300, 300);
  paintColorbar(img, 100, 129, 30, 269, VIRIDISH.slice(2));
  outline(img, 99, 29, 131, 271, 1, [0, 0, 0]);
  for (const y of [60, 150, 240]) [fill(img, 100, y, 105, y + 1, [0, 0, 0]), label(img, 76, y - 5, 2)];
  for (let i = 0; i < 9; i++) fill(img, 145, 70 + i * 16, 158, 80 + i * 16);
  const { side, marks } = findTickLabels(img, { x0: 100, y0: 30, x1: 130, y1: 270 });
  assert.equal(side, 'left');
  assert.deepEqual(marks.map((m) => Math.round(m.at.y)), [60, 150, 240]);
});

test('findTickLabels skips excluded cells and keeps wide labels whole', () => {
  // Test-3: the neighbour heatmap's dark cells left of the bar; test-7:
  // labels 5 characters wide ("46.08") with tick marks 12 px long.
  const img = makeImage(400, 300);
  paintHeatmap(img, rect(20, 30, 190, 270), matrix(12, 6), [[60, 0, 0], [120, 10, 10], [80, 20, 20]], { lines: false });
  paintColorbar(img, 200, 219, 30, 269, VIRIDISH);
  for (const y of [30, 110, 190, 269]) [fill(img, 220, y, 232, y + 1), label(img, 236, y - 5, 5)];
  const { side, marks } = findTickLabels(img, { x0: 200, y0: 30, x1: 220, y1: 270 }, { exclude: [{ x0: 20, y0: 30, x1: 190, y1: 270 }] });
  assert.equal(side, 'right');
  assert.equal(marks.length, 4);
  assert.ok(marks.every((m) => m.box.x0 === 236 && m.box.x1 === 274), JSON.stringify(marks.map((m) => m.box)));
});

test('findTickLabels leaves out an axis title under the labels', () => {
  // Test-5: "Log2 (fold change …)" 12 px under the numbers of a horizontal bar.
  const img = makeImage(400, 140);
  for (let x = 40; x < 360; x++) fill(img, x, 20, x + 1, 36, cmap(RDBU, (x - 40) / 319));
  for (const x of [40, 120, 200, 280, 359]) label(img, x - 7, 42, 2);
  label(img, 60, 64, 30);
  const { side, marks } = findTickLabels(img, { x0: 40, y0: 20, x1: 360, y1: 36 });
  assert.equal(side, 'below');
  assert.equal(marks.length, 5);
});

test('findColorbars calls a row of same-colored label boxes categorical', () => {
  // Test-13's "Tails" boxes: one yellow, split by white lines, a name on each.
  const img = makeImage(200, 400);
  fill(img, 40, 20, 90, 372, [252, 242, 215]); // pale lines between the boxes
  for (let i = 0; i < 8; i++) {
    fill(img, 40, 20 + i * 44, 90, 62 + i * 44, [250, 228, 170]);
    label(img, 52, 35 + i * 44, 2);
  }
  paintColorbar(img, 150, 165, 20, 370, VIRIDISH);
  const kinds = CM.findColorbars(img).map((b) => `${b.x0}:${b.kind}`);
  assert.deepEqual(kinds.sort(), ['150:smooth', '40:categorical']);
});

test('findTickLabels leaves out frame lines, a title between bins and a rotated title', () => {
  // A binned bar of 5 bins with its frame broken into pieces under it (t4),
  // a title box above its first step (t2's "RLU") and a rotated title beside
  // the middle of the other side (t14).
  const img = makeImage(260, 420);
  const bins = [[49, 54, 149], [69, 117, 180], [171, 217, 233], [253, 174, 97], [215, 48, 39]];
  for (let y = 40; y < 340; y++) for (let x = 100; x < 120; x++) setPixel(img, x, y, bins[Math.floor((y - 40) / 60)]);
  for (const y of [40, 100, 160, 220, 280, 339]) label(img, 128, y - 5, 2);
  label(img, 128, 64, 3); // title in the first bin
  fill(img, 121, 120, 123, 200); // a piece of the frame along the bar
  for (let i = 0; i < 6; i++) fill(img, 70, 150 + i * 12, 80, 160 + i * 12); // rotated title glyphs
  const { side, marks } = findTickLabels(img, { x0: 100, y0: 40, x1: 120, y1: 340 });
  assert.equal(side, 'right');
  assert.deepEqual(marks.map((m) => Math.round(m.at.y)), [40, 100, 160, 220, 280, 339]);
});

test('findTickLabels extends a strip to a label past its pale end', () => {
  // Test-10's -log10(p) bar fades to near white: the strip search stops
  // 20 px before the label of its end.
  const img = makeImage(200, 300);
  for (let y = 40; y < 240; y++) for (let x = 60; x < 80; x++) setPixel(img, x, y, cmap([[90, 80, 160], [244, 243, 248]], (y - 40) / 200));
  for (const y of [40, 90, 140, 190, 240]) label(img, 88, y - 5, 2);
  const found = findTickLabels(img, { x0: 60, y0: 40, x1: 80, y1: 220 });
  assert.equal(found.marks.length, 5);
  assert.equal(found.bar.y1, 241);
});

test('snapBlock does not join a separately framed block across a gap', () => {
  // Test-1: a framed block of 3 rows and its framed Average row 11 px
  // below; the decision model's box covers both.
  const img = makeImage(300, 260);
  paintHeatmap(img, rect(42, 32, 242, 152), matrix(3, 5), VIRIDISH, { lines: false });
  outline(img, 40, 30, 244, 154, 2);
  paintHeatmap(img, rect(42, 167, 242, 207), matrix(1, 5), VIRIDISH, { lines: false });
  outline(img, 40, 165, 244, 209, 2);
  const b = snapBlock(img, { x0: 38, y0: 28, x1: 246, y1: 211 });
  assert.ok(near(b, { x0: 41, y0: 31, x1: 243, y1: 153 }), JSON.stringify(b));
});

test('snapEdges moves an edge that cuts into the cells out to their edge', () => {
  // Test-1: the LLM read a framed Average row's bottom 12 px short.
  const img = makeImage(300, 200);
  paintHeatmap(img, rect(42, 52, 242, 132), matrix(1, 5), VIRIDISH, { lines: false });
  outline(img, 40, 50, 244, 134, 2);
  const b = CM.snapEdges(img, { x0: 41, y0: 51, x1: 243, y1: 121 });
  assert.ok(near(b, { x0: 41, y0: 51, x1: 243, y1: 133 }), JSON.stringify(b));
});

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { cmapData } from '../../core/colormap-library.ts';
import { parseHexColors } from '../../core/cvd.ts';
import { rectCorners } from '../../core/grid.ts';
import type { ColormapRef, Corners, HeatmapResult, PixelImage, Rgb } from '../../types/index.ts';
import { createPanel } from '../project/project.ts';
import { extractPanel, panelProblem } from './sampling.ts';
import { makeImage, setPixel, cmap, paintHeatmap, paintColorbar, paintDots, VIRIDISH } from '../../testing/helpers.ts';


function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

function setup(corners: Corners, rows: number, cols: number) {
  const rand = seeded(42);
  const matrix = Array.from({ length: rows }, () => Array.from({ length: cols }, () => rand()));
  const img = makeImage(200, 260);
  paintHeatmap(img, corners, matrix, VIRIDISH);
  paintColorbar(img, 150, 160, 20, 219, VIRIDISH);
  const panel = createPanel('test');
  panel.grid.corners = corners;
  panel.grid.rows = rows;
  panel.grid.cols = cols;
  panel.colorbar.start = { x: 155, y: 219 };
  panel.colorbar.end = { x: 155, y: 20 };
  return { img, panel, matrix };
}

test('panelProblem guides through calibration steps', () => {
  const p = createPanel();
  assert.match(panelProblem(p) as string, /grid/);
  p.grid.corners = rectCorners({ x: 0, y: 0 }, { x: 10, y: 10 });
  assert.match(panelProblem(p) as string, /colorbar/);
  p.colorbar.start = { x: 0, y: 100 };
  p.colorbar.end = { x: 0, y: 0 };
  assert.match(panelProblem(p) as string, /two ticks/);
});

test('round trip on an axis-aligned heatmap with linear ticks', () => {
  const { img, panel, matrix } = setup(rectCorners({ x: 20, y: 20 }, { x: 120, y: 220 }), 8, 4);
  // Ticks at values 2 and 8 on a 0–10 bar (bottom → top).
  const yAt = (v: number) => 219 - (v / 10) * 199;
  panel.colorbar.ticks = [{ x: 158, y: yAt(2), value: 2 }, { x: 152, y: yAt(8), value: 8 }];
  const res = extractPanel(img, panel) as HeatmapResult;
  assert.equal(res.error, undefined);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 4; c++) {
      const cell = res.cells[r][c];
      assert.ok(Math.abs(cell.value - matrix[r][c] * 10) < 0.08, `cell ${r},${c}: ${cell.value} vs ${matrix[r][c] * 10}`);
      assert.equal(cell.flagged, false);
    }
  }
});

test('round trip on a skewed heatmap with log ticks', () => {
  const corners = [{ x: 22, y: 18 }, { x: 125, y: 26 }, { x: 118, y: 232 }, { x: 14, y: 224 }];
  const { img, panel, matrix } = setup(corners, 10, 5);
  // Bar spans 10^0 .. 10^3 from bottom to top.
  const yAt = (v: number) => 219 - (Math.log10(v) / 3) * 199;
  panel.colorbar.scale = 'log10';
  panel.colorbar.ticks = [1, 10, 100, 1000].map((v) => ({ x: 155, y: yAt(v), value: v }));
  const res = extractPanel(img, panel) as HeatmapResult;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 5; c++) {
      const expected = Math.log10(Math.pow(10, matrix[r][c] * 3));
      assert.ok(Math.abs(Math.log10(res.cells[r][c].value) - expected) < 0.03, `cell ${r},${c}`);
    }
  }
});

test('a known colormap calibrates without a colorbar in the figure', () => {
  // Cells painted from the library's viridis; no bar on the page at all.
  const viridis = parseHexColors(cmapData!.maps.find((m) => m.name === 'viridis')!.colors);
  const truth = [[0, 0.25], [0.5, 1]];
  const corners = rectCorners({ x: 10, y: 10 }, { x: 110, y: 110 });
  const img = makeImage(130, 130);
  paintHeatmap(img, corners, truth, viridis, { lines: false });
  const p = createPanel();
  p.grid.corners = corners;
  p.grid.rows = 2;
  p.grid.cols = 2;
  p.colorbar.colormap = { name: 'viridis', reversed: false };
  assert.match(panelProblem(p) as string, /two ticks/);
  // The ends typed as positions along the colormap: 0% = 10, 100% = 20.
  p.colorbar.ticks = [{ id: 'a', t: 0, value: 10 }, { id: 'b', t: 1, value: 20 }];
  assert.equal(panelProblem(p), null);
  const res = extractPanel(img, p) as HeatmapResult;
  res.cells.flat().forEach((c, i) => {
    assert.ok(Math.abs(c.value - (10 + 10 * truth.flat()[i])) < 0.1, `${c.value}`);
  });
  // Reversed: the same colors read from the other end.
  p.colorbar.colormap!.reversed = true;
  assert.ok(Math.abs((extractPanel(img, p) as HeatmapResult).cells[1][1].value - 10) < 0.1);
  p.colorbar.colormap = { name: 'no-such-map' } as ColormapRef;
  assert.match(panelProblem(p) as string, /Unknown colormap/);
});

test('dot plot: dots of varying size are read inside each dot, empty cells are blank', () => {
  const matrix = [[0.1, 0.4, 0.7], [0.9, 0.3, 0.6]];
  const radii = [[4, 9, 2.5], [7, 0, 11]];
  const img = makeImage(200, 260);
  paintDots(img, { x: 30, y: 60 }, { x: 110, y: 130 }, matrix, radii, VIRIDISH);
  paintColorbar(img, 150, 160, 20, 219, VIRIDISH);
  const panel = createPanel('dots');
  Object.assign(panel.grid, { anchor: 'centers', shape: 'circle', sampleFraction: 0.7, rows: 2, cols: 3 });
  panel.grid.corners = rectCorners({ x: 30, y: 60 }, { x: 110, y: 130 });
  panel.colorbar.start = { x: 155, y: 219 };
  panel.colorbar.end = { x: 155, y: 20 };
  panel.colorbar.ticks = [{ x: 155, y: 219, value: 0 }, { x: 155, y: 20, value: 10 }];
  const res = extractPanel(img, panel) as HeatmapResult;
  assert.equal(res.error, undefined);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const cell = res.cells[r][c];
      if (!radii[r][c]) {
        assert.equal(cell.empty, true);
        assert.ok(Number.isNaN(cell.value));
        continue;
      }
      assert.ok(Math.abs(cell.value - matrix[r][c] * 10) < 0.15, `cell ${r},${c}: ${cell.value} vs ${matrix[r][c] * 10}`);
    }
  }
});

test('dot centers need two rows and two columns', () => {
  const p = createPanel();
  p.grid.anchor = 'centers';
  p.grid.corners = rectCorners({ x: 0, y: 0 }, { x: 10, y: 10 });
  p.grid.rows = 1;
  assert.match(panelProblem(p) as string, /at least 2 rows/);
});

// A 1 × n heatmap of flat cells with the given colors, 20 px each from (20, 20).
function paintCells(img: PixelImage, colors: Rgb[]) {
  colors.forEach((rgb, c) => {
    for (let y = 20; y < 60; y++) for (let x = 20 + 20 * c; x < 40 + 20 * c; x++) setPixel(img, x, y, rgb);
  });
  return rectCorners({ x: 20, y: 20 }, { x: 20 + 20 * colors.length, y: 60 });
}

test('binned bar: cells read the middle of their bin, end bins are open', () => {
  const BINS = [[33, 137, 199], [136, 219, 251], [212, 235, 251], [245, 230, 225], [253, 175, 163], [247, 106, 94], [247, 45, 41]];
  const img = makeImage(200, 260);
  // Seven bins from the bottom (y 219) to the top (y 20), labelled at the six inner boundaries.
  const yAt = (k: number) => 219 - (k * 199) / 7;
  for (let y = 20; y <= 219; y++) for (let x = 150; x <= 160; x++) setPixel(img, x, y, BINS[Math.min(6, Math.floor((219 - y) / (199 / 7)))]);
  const panel = createPanel('binned');
  panel.grid.corners = paintCells(img, [BINS[0], BINS[2], BINS[3], BINS[6]]);
  panel.grid.rows = 1;
  panel.grid.cols = 4;
  panel.colorbar.start = { x: 155, y: 219 };
  panel.colorbar.end = { x: 155, y: 20 };
  const values = [1e4, 2e4, 2e5, 5e5, 1e6, 3e6];
  panel.colorbar.ticks = values.map((value, i) => ({ x: 155, y: yAt(i + 1), value }));
  panel.colorbar.scale = 'piecewise-log10';
  const res = extractPanel(img, panel) as HeatmapResult;
  assert.equal(res.bins!.length, 7);
  const [low, b2, b3, high] = res.cells[0];
  assert.deepEqual([low.value, low.open, low.bin], [1e4, 'below', 0]);
  assert.ok(Math.abs(b2.value / Math.sqrt(2e4 * 2e5) - 1) < 1e-9, `${b2.value}`);
  assert.ok(Math.abs(b3.value / Math.sqrt(2e5 * 5e5) - 1) < 1e-9, `${b3.value}`);
  assert.equal(b2.open, undefined);
  assert.deepEqual([high.value, high.open], [3e6, 'above']);
  assert.equal(res.counts.open, 2);
  assert.equal(res.counts.ok, 4);
});

test('off-map cells have no value and a reason; cells past an end clamp to it', () => {
  const img = makeImage(200, 260);
  paintColorbar(img, 150, 160, 20, 219, VIRIDISH);
  const panel = createPanel('off-map');
  // On the map, a gray "ND" cell, a magenta one, black, and a deeper purple
  // than the bar's low end.
  const cells = [cmap(VIRIDISH, 0.5), [150, 150, 150], [230, 0, 230], [0, 0, 0], [52, 0, 66]];
  panel.grid.corners = paintCells(img, cells);
  panel.grid.rows = 1;
  panel.grid.cols = cells.length;
  panel.colorbar.start = { x: 155, y: 219 };
  panel.colorbar.end = { x: 155, y: 20 };
  panel.colorbar.ticks = [{ x: 155, y: 219, value: 0 }, { x: 155, y: 20, value: 10 }];
  const res = extractPanel(img, panel) as HeatmapResult;
  const [ok, gray, magenta, black, deep] = res.cells[0];
  assert.equal(res.bins, null);
  assert.equal(ok.status, 'ok');
  assert.ok(Math.abs(ok.value - 5) < 0.1);
  for (const c of [gray, magenta, black]) {
    assert.equal(c.status, 'off-map');
    assert.ok(Number.isNaN(c.value));
    assert.equal(c.flagged, true);
  }
  assert.equal(gray.reason, 'gray');
  assert.equal(black.reason, 'gray');
  assert.deepEqual([deep.status, deep.end, deep.open, deep.value], ['clamped', 'start', 'below', 0]);
  assert.deepEqual(res.counts, { cells: 5, ok: 1, flagged: 0, clamped: 1, offMap: 3, empty: 0, open: 1 });
  assert.ok(Math.abs(res.clampedShare - 0.2) < 1e-12);
});

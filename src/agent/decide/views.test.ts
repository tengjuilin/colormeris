import assert from 'node:assert/strict';
import { test } from 'vitest';
import { scaleNote } from './ticks.ts';
import { boxText, candidateLines, clipBox, likelySides, regions, sideGap, where } from './views.ts';

const cells = { x0: 100, y0: 100, x1: 300, y1: 200 };

test('region recipes: crop, side, bar and grid grow their box and stay on the page', () => {
  assert.deepEqual(regions.crop(cells, 1000, 1000), { x0: 30, y0: 55, x1: 370, y1: 245 });
  assert.deepEqual(regions.side(cells, 1000, 1000), { x0: 10, y0: 45, x1: 390, y1: 255 });
  assert.deepEqual(regions.grid(cells, 1000, 1000), { x0: 80, y0: 85, x1: 320, y1: 215 });
  const bar = { x0: 320, y0: 100, x1: 330, y1: 200 };
  const label = { x0: 335, y0: 95, x1: 350, y1: 105 };
  assert.deepEqual(regions.bar(bar, [label], 1000, 1000), { x0: 277, y0: 44.5, x1: 393, y1: 250.5 });
  assert.deepEqual(regions.crop(cells, 320, 210), { x0: 30, y0: 55, x1: 320, y1: 210 });
});

test('regions.panel reaches to the white gaps, with room on the right for box numbers', () => {
  const reach = { left: 60, above: 90, right: 340, below: 260 };
  const r = regions.panel(cells, [{ x0: 310, y0: 90, x1: 320, y1: 210 }], (s) => reach[s], 1000, 1000);
  assert.deepEqual(r, { x0: 52, y0: 82, x1: 370, y1: 268 });
  // Clipped to the page.
  assert.deepEqual(
    regions.panel(cells, [], () => 0, 310, 205),
    { x0: 0, y0: 0, x1: 310, y1: 205 },
  );
});

test('regions.ticks shows the cells too unless the bar is far from them', () => {
  const near = regions.ticks(cells, { x: 320, y: 200 }, { x: 320, y: 100 }, [], 1000, 1000);
  assert.equal(near.apart, false);
  assert.ok(near.region.x0 < 100);
  const far = regions.ticks(cells, { x: 600, y: 200 }, { x: 600, y: 100 }, [], 1000, 1000);
  assert.equal(far.apart, true);
  assert.ok(far.region.x0 > 300);
});

test('box texts, sides and gaps', () => {
  assert.equal(boxText({ x0: 1.04, y0: 2, x1: 3.25, y1: 4 }), 'x 1–3.3, y 2–4');
  assert.equal(where(cells, { x0: 310, y0: 210, x1: 320, y1: 260 }), 'right of and below');
  assert.equal(where(cells, { x0: 150, y0: 150, x1: 160, y1: 160 }), 'over');
  assert.equal(sideGap(cells, { x0: 320, y0: 100, x1: 330, y1: 200 }), 20);
  assert.deepEqual(clipBox({ x0: 50, y0: -5, x1: -10, y1: 40 }, 30, 30), { x0: 0, y0: 0, x1: 30, y1: 30 });
  assert.deepEqual(
    likelySides({ choice: 'right', probabilities: { right: 0.6, left: 0.3, above: 0.04, none: 0.06 } }),
    ['right', 'left'],
  );
  assert.deepEqual(likelySides({ choice: 'below' }), ['below']);
  assert.deepEqual(
    candidateLines(cells, [{ letter: 'A', bar: { x0: 320, y0: 100, x1: 330, y1: 200 }, gap: 20, labels: 1 }]),
    ['A: vertical, right of the cells, 20 px away, x 320–330, y 100–200, 1 tick label'],
  );
});

test('scaleNote says why the app picked a scale', () => {
  assert.equal(scaleNote('piecewise', true), ' The colorbar is binned, so the app set the scale to piecewise.');
  assert.equal(
    scaleNote('log10', false),
    ' The tick values grow by constant factors, so the app set the scale to log10.',
  );
  assert.equal(
    scaleNote('piecewise', false),
    ' The ticks are unevenly spaced along the bar for their values, so the app set the scale to piecewise (values between neighbouring ticks).',
  );
});

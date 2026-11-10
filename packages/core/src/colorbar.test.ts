import assert from 'node:assert/strict';
import { test } from 'vitest';
import { deltaE2000, rgbToLab } from './color.ts';
import { colorAtT, labToT, projectT, sampleColorbar } from './colorbar.ts';
import { refineColorbar } from './colorbar-refine.ts';
import { colormapSamples } from './colormap-match.ts';
import { cmap, makeImage, paintColorbar, setPixel, VIRIDISH } from './testing.ts';

const close = (a: number, b: number, eps: number, msg = '') => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b} ${msg}`);

test('projectT projects onto the line', () => {
  close(projectT({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: 7 }), 0.4, 1e-12);
  close(projectT({ x: 0, y: 100 }, { x: 0, y: 0 }, { x: 3, y: 25 }), 0.75, 1e-12);
});

test('sampleColorbar and labToT recover positions along a painted bar', () => {
  const img = makeImage(40, 240);
  paintColorbar(img, 10, 20, 20, 219, VIRIDISH);
  const samples = sampleColorbar(img, { x: 15, y: 219 }, { x: 15, y: 20 }, 2, 256);
  assert.equal(samples.length, 256);
  for (const s of [0, 0.13, 0.5, 0.77, 1]) {
    const { t, deltaE } = labToT(rgbToLab(cmap(VIRIDISH, s)), samples);
    close(t, s, 0.01);
    assert.ok(deltaE < 2);
  }
  const mid = colorAtT(samples, 0.5);
  cmap(VIRIDISH, 0.5).forEach((c, i) => close(mid[i], c, 4));
});

test('labToT reports large deltaE for off-colormap colors', () => {
  const img = makeImage(40, 240);
  paintColorbar(img, 10, 20, 20, 219, VIRIDISH);
  const samples = sampleColorbar(img, { x: 15, y: 219 }, { x: 15, y: 20 }, 2, 256);
  assert.ok(labToT(rgbToLab([255, 0, 0]), samples).deltaE > 10);
});

// A vertical viridis bar at x 20–39, y 30–229 (value 1 at the top) with a
// 1 px black outline and tick marks on the right at y 30, 130 and 229.
function outlinedBar() {
  const img = makeImage(90, 260);
  for (let y = 29; y <= 230; y++) for (let x = 19; x <= 40; x++) setPixel(img, x, y, [0, 0, 0]);
  paintColorbar(img, 20, 39, 30, 229, VIRIDISH);
  for (const y of [30, 130, 229]) for (let x = 41; x <= 46; x++) setPixel(img, x, y, [0, 0, 0]);
  return img;
}

test('refineColorbar centres a rough line and puts its ends on the last colors', () => {
  const img = outlinedBar();
  // Near the left edge, one end on the outline and beyond, the other short.
  const r = refineColorbar(img, { x: 22, y: 234 }, { x: 22, y: 37 });
  assert.ok(r, 'strip found');
  close(r.start.x, 29.5, 1.01);
  close(r.end.x, 29.5, 1.01);
  assert.ok(r.start.y <= 229 && r.start.y >= 227, `start y ${r.start.y}`);
  assert.ok(r.end.y >= 30 && r.end.y <= 32, `end y ${r.end.y}`);
  assert.ok(r.halfWidth >= 2 && r.halfWidth <= 6);
  assert.deepEqual(r.found, { start: true, end: true });
});

test('refineColorbar gives up when the line is not on a colorbar', () => {
  const img = makeImage(90, 260);
  assert.equal(refineColorbar(img, { x: 30, y: 230 }, { x: 30, y: 30 }), null);
});

test('labToT pruning gives the same match as a plain scan over all samples', () => {
  const samples = colormapSamples({ name: 'viridis' }, 256)!;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let n = 0; n < 300; n++) {
    const lab = rgbToLab([rnd() * 255, rnd() * 255, rnd() * 255]);
    let best = 0;
    let bestD = Infinity;
    samples.forEach((s, i) => {
      const d = deltaE2000(lab, s.lab);
      if (d < bestD) [bestD, best] = [d, i];
    });
    const got = labToT(lab, samples, 'de2000');
    // Refinement between neighbours only lowers deltaE, so compare against it.
    assert.ok(got.deltaE <= bestD + 1e-12);
    assert.ok(Math.abs(got.t - samples[best].t) <= 1 / 255 + 1e-12);
  }
});

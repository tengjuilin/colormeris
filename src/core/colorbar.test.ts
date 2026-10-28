import assert from 'node:assert/strict';
import { test } from 'vitest';
import { cmap, makeImage, paintColorbar, setPixel, VIRIDISH } from '../testing/helpers.ts';
import type { ColorbarSample, Rgb } from '../types/index.ts';
import { deltaE76, deltaE2000, rgbToLab } from './color.ts';
import {
  colorAtT,
  colorbarBins,
  colorStatus,
  isLogScale,
  isPiecewiseScale,
  labelBins,
  labToT,
  makeValueFn,
  piecewiseScaleFor,
  projectT,
  refineColorbar,
  SCALES,
  sampleColorbar,
  snapTick,
  tickProblem,
} from './colorbar.ts';
import { colormapSamples } from './colormap-match.ts';

const close = (a: number, b: number, eps: number, msg = '') => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b} ${msg}`);

test('projectT projects onto the line', () => {
  close(projectT({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: 7 }), 0.4, 1e-12);
  close(projectT({ x: 0, y: 100 }, { x: 0, y: 0 }, { x: 3, y: 25 }), 0.75, 1e-12);
});

test('makeValueFn interpolates and extrapolates linearly', () => {
  const f = makeValueFn([
    { t: 0.2, value: 3 },
    { t: 0.6, value: 5 },
    { t: 1, value: 6 },
  ])!;
  close(f(0.2), 3, 1e-12);
  close(f(0.4), 4, 1e-12);
  close(f(0.8), 5.5, 1e-12);
  close(f(0), 2, 1e-12);
});

test('makeValueFn log10 interpolates in log space', () => {
  const f = makeValueFn(
    [
      { t: 0, value: 1 },
      { t: 1, value: 1000 },
    ],
    'log10',
  )!;
  close(f(1 / 3), 10, 1e-9);
  close(f(2 / 3), 100, 1e-9);
});

test('tickProblem reports missing or invalid ticks', () => {
  assert.ok(tickProblem([{ t: 0.1, value: 1 }], 'linear'));
  assert.ok(
    tickProblem(
      [
        { t: 0.1, value: 1 },
        { t: 0.1, value: 2 },
      ],
      'linear',
    ),
  );
  assert.ok(
    tickProblem(
      [
        { t: 0, value: 0 },
        { t: 1, value: 2 },
      ],
      'log10',
    ),
  );
  assert.equal(
    tickProblem(
      [
        { t: 0, value: 0 },
        { t: 1, value: 2 },
      ],
      'linear',
    ),
    null,
  );
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

test('snapTick moves a tick onto the nearest tick mark', () => {
  const img = outlinedBar();
  const start = { x: 29.5, y: 229 };
  const end = { x: 29.5, y: 30 };
  const k = snapTick(img, start, end, { x: 60, y: 126 });
  assert.ok(k, 'mark found');
  close(k.point.y, 130, 0.6);
  close(k.moved, -4, 0.6, 'towards the end at the top');
  assert.equal(snapTick(makeImage(90, 260), start, end, { x: 60, y: 126 }), null);
});

test('snapTick also finds marks drawn into the strip from its edge', () => {
  const img = makeImage(90, 260);
  paintColorbar(img, 20, 39, 30, 229, VIRIDISH);
  for (const x of [37, 38, 39]) for (const y of [150, 151]) setPixel(img, x, y, [20, 20, 20]);
  const k = snapTick(img, { x: 29.5, y: 229 }, { x: 29.5, y: 30 }, { x: 60, y: 146 });
  assert.ok(k, 'mark found');
  close(k.point.y, 150.5, 0.6);
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

// ------------------------------------------------ scales, bins and off-map colors

// Samples [{t, rgb, lab}] of a bar given as rgb(s) for s in [0, 1].
function barSamples(rgbAt: (t: number) => Rgb, n = 256): ColorbarSample[] {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const rgb = rgbAt(t);
    return { t, rgb, lab: rgbToLab(rgb) };
  });
}
// A binned bar: `colors` in equal bins, with one anti-aliased sample (the
// mean of two neighbours) at each step, like a rendered figure.
function binnedBar(colors: Rgb[], n = 256) {
  const k = colors.length;
  return barSamples((t) => {
    const x = t * k;
    const i = Math.min(k - 1, Math.floor(x));
    const f = x - i;
    if (i > 0 && f < 0.5 / (n / k)) return colors[i - 1].map((c, j) => Math.round((c + colors[i][j]) / 2));
    return colors[i];
  }, n);
}
const BINS7: Rgb[] = [
  [33, 137, 199],
  [136, 219, 251],
  [212, 235, 251],
  [245, 230, 225],
  [253, 175, 163],
  [247, 106, 94],
  [247, 45, 41],
];

test('piecewise scales: log10 between neighbours, steady values, a suggested twin', () => {
  assert.deepEqual(SCALES, ['linear', 'log10', 'piecewise', 'piecewise-log10']);
  assert.ok(isLogScale('piecewise-log10') && isLogScale('log10') && !isLogScale('piecewise'));
  assert.ok(isPiecewiseScale('piecewise') && !isPiecewiseScale('linear'));
  // Uneven labels at even steps (a binned bar's boundaries).
  const ticks = [1e4, 2e4, 2e5, 5e5, 1e6, 3e6].map((value, i) => ({ t: (i + 1) / 7, value }));
  const f = makeValueFn(ticks, 'piecewise-log10')!;
  close(f(2.5 / 7), Math.sqrt(2e4 * 2e5), 1e-6);
  close(makeValueFn(ticks, 'piecewise')!(2.5 / 7), 1.1e5, 1e-6);
  assert.equal(piecewiseScaleFor(ticks), 'piecewise-log10');
  assert.equal(piecewiseScaleFor([0, 3, 6].map((value, i) => ({ t: i / 2, value }))), 'piecewise');
  assert.equal(piecewiseScaleFor([1, 2, 5].map((value, i) => ({ t: i / 2, value }))), 'piecewise');
  // Values that turn back cannot be interpolated between neighbours.
  assert.match(
    tickProblem(
      [
        { t: 0, value: 1 },
        { t: 0.5, value: 5 },
        { t: 1, value: 2 },
      ],
      'piecewise',
    )!,
    /steadily/,
  );
  assert.equal(
    tickProblem(
      [
        { t: 0, value: 9 },
        { t: 0.5, value: 5 },
        { t: 1, value: 2 },
      ],
      'piecewise',
    ),
    null,
  );
  assert.ok(
    tickProblem(
      [
        { t: 0, value: 0 },
        { t: 1, value: 2 },
      ],
      'piecewise-log10',
    ),
  );
});

test('colorbarBins finds the bins of a discrete bar and nothing on smooth ones', () => {
  const bins = colorbarBins(binnedBar(BINS7))!;
  assert.equal(bins.length, 7);
  bins.forEach((b, i) => {
    close(b.t0, i / 7, 0.01, `bin ${i} start`);
    close(b.t1, (i + 1) / 7, 0.01, `bin ${i} end`);
    assert.ok(deltaE76(b.lab, rgbToLab(BINS7[i])) < 1);
  });
  assert.equal(colorbarBins(barSamples((t) => cmap(VIRIDISH, t))), null);
  // A tick mark drawn into a smooth bar splits it, but its parts are not flat.
  assert.equal(colorbarBins(barSamples((t) => (Math.abs(t - 0.5) < 0.003 ? [0, 0, 0] : cmap(VIRIDISH, t)))), null);
  // A tick mark inside a bin does not split that bin.
  const marked = binnedBar(BINS7).map((s, i) => (i === 18 ? { ...s, rgb: [0, 0, 0], lab: rgbToLab([0, 0, 0]) } : s));
  assert.equal(colorbarBins(marked)!.length, 7);
});

test('labelBins: bin middles in the scale, open-ended bins past the outermost ticks', () => {
  const bins = colorbarBins(binnedBar(BINS7))!;
  // Linear ticks on every boundary, ends included (0, 3, … 21): arithmetic middles.
  const lin = labelBins(
    bins,
    [0, 3, 6, 9, 12, 15, 18, 21].map((value, i) => ({ t: i / 7 + 0.002, value })),
    'piecewise',
  )!;
  lin.forEach((b, i) => close(b.value, 1.5 + 3 * i, 1e-9, `bin ${i}`));
  assert.ok(lin.every((b) => b.open === null));
  // Uneven log-like ticks on the inner boundaries only: geometric middles,
  // and the end bins say "below 1e4" and "above 3e6".
  const values = [1e4, 2e4, 2e5, 5e5, 1e6, 3e6];
  const log = labelBins(
    bins,
    values.map((value, i) => ({ t: (i + 1) / 7, value })),
    'piecewise-log10',
  )!;
  assert.deepEqual([log[0].value, log[0].open], [1e4, 'below']);
  assert.deepEqual([log[6].value, log[6].open], [3e6, 'above']);
  for (let i = 1; i < 6; i++) close(log[i].value, Math.sqrt(values[i - 1] * values[i]), values[i] * 1e-9, `bin ${i}`);
  // A bar running the other way (high values at t = 0) opens the other way.
  const down = labelBins(
    bins,
    values.map((value, i) => ({ t: (6 - i) / 7, value })),
    'piecewise-log10',
  )!;
  assert.deepEqual([down[0].open, down[6].open], ['above', 'below']);
  // Ticks at bin centres: each bin reads its label.
  const centres = labelBins(
    bins,
    [1, 2, 3, 4, 5, 6, 7].map((value, i) => ({ t: (i + 0.5) / 7, value })),
    'linear',
  )!;
  centres.forEach((b, i) => close(b.value, i + 1, 0.05));
});

test('colorStatus: off-map grays and hues, clamped cells past an end', () => {
  const status = (rgb: Rgb, samples: ColorbarSample[]) => {
    const lab = rgbToLab(rgb);
    return colorStatus(lab, labToT(lab, samples), samples, 10);
  };
  const diverging = barSamples((t) =>
    cmap(
      [
        [33, 60, 200],
        [245, 245, 250],
        [200, 30, 30],
      ],
      t,
    ),
  );
  // A gray "ND" cell beside a colorful bar, and a black diagonal past its dark blue end.
  assert.deepEqual(status([183, 183, 183], diverging), { status: 'off-map', reason: 'gray' });
  assert.equal(status([0, 0, 0], diverging).status, 'off-map');
  assert.equal(status([40, 200, 40], diverging).status, 'off-map');
  assert.equal(
    status(
      cmap(
        [
          [33, 60, 200],
          [245, 245, 250],
          [200, 30, 30],
        ],
        0.3,
      ),
      diverging,
    ).status,
    'ok',
  );
  // test-9: a mid gray (L* 77) beside a pale blue of chroma 11.6 at L* 85 on an RdBu bar is ND, not pale blue.
  // Its real bar is near neutral there too (chroma 7 at L* 70–85).
  const knots = [
    [50, -10, -40],
    [80, -5, -5],
    [97, 0, 0],
  ];
  const lerp = (t: number) =>
    t < 0.5
      ? [0, 1, 2].map((i) => knots[0][i] + (knots[1][i] - knots[0][i]) * 2 * t)
      : [0, 1, 2].map((i) => knots[1][i] + (knots[2][i] - knots[1][i]) * (2 * t - 1));
  const paleBlue = Array.from({ length: 101 }, (_, i) => ({ t: i / 100, lab: lerp(i / 100) })) as ColorbarSample[];
  const gray = rgbToLab([191, 191, 191]);
  assert.deepEqual(colorStatus(gray, labToT(gray, paleBlue), paleBlue, 10), { status: 'off-map', reason: 'gray' });
  // Grays on a grayscale bar and near-whites on a white-ended bar are on the map.
  assert.equal(
    status(
      [128, 128, 128],
      barSamples((t) =>
        cmap(
          [
            [0, 0, 0],
            [255, 255, 255],
          ],
          t,
        ),
      ),
    ).status,
    'ok',
  );
  assert.equal(
    status(
      [240, 246, 252],
      barSamples((t) =>
        cmap(
          [
            [247, 251, 255],
            [8, 48, 107],
          ],
          t,
        ),
      ),
    ).status,
    'ok',
  );
  // Paler than a pink low end (cells past the colorbar): clamped there.
  const pink = barSamples((t) =>
    cmap(
      [
        [218, 136, 138],
        [150, 20, 30],
      ],
      t,
    ),
  );
  assert.deepEqual(status([243, 222, 222], pink), { status: 'clamped', end: 'start' });
  assert.deepEqual(status([110, 5, 15], pink), { status: 'clamped', end: 'end' });
  // Exactly the end color is on the bar.
  assert.equal(status([218, 136, 138], pink).status, 'ok');
  // Past a flat end (binned bar): lighter than the whole bar and of its family.
  const reds = binnedBar([
    [254, 200, 200],
    [240, 120, 120],
    [180, 30, 30],
  ]);
  const lab = rgbToLab([254, 236, 236]);
  assert.equal(colorStatus(lab, { t: 0, deltaE: 8 }, reds, 10).status, 'clamped');
});

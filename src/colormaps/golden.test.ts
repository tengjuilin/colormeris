// Golden tests over the whole colormap library: a hash of every map's
// metrics, view colors (both directions), interpolated colors and colorbar
// samples. They guard refactors of the shared caches and helpers: the
// numbers must stay the same (rounded to 1e-9, so float noise passes).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cmapColorAt, cmapData, colormapMetrics, colormapSamples, parseHexColors } from 'colormeris';
import { test } from 'vitest';
import type { ViewKey } from '../types/index.ts';
import { colorsLut } from './app/compare/test-pattern.ts';
import { metrics, viewData } from './library-cache.ts';
import { indexColors, recolorPixels } from './recolor.ts';

// Each test runs over the whole library (about 1 s alone, several under a full parallel run).
const SLOW = 60_000;
const VIEW_KEYS: ViewKey[] = ['orig', 'protanopia', 'deuteranopia', 'tritanopia', 'gray'];

// Numbers rounded to 1e-9, so the hash ignores floating-point noise.
function hashOf(value: unknown) {
  const json = JSON.stringify(value, (_k, v) =>
    typeof v === 'number' ? (Number.isFinite(v) ? Math.round(v * 1e9) / 1e9 : String(v)) : v,
  );
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

test(
  'golden: colormapMetrics of every map',
  () => {
    // The viewer's cached path over every map…
    assert.equal(hashOf(cmapData.maps.map(metrics)), 'c7d9342ddd2486ed');
    // …and the plain function on a sample of them gives the same numbers.
    for (const m of cmapData.maps.filter((_, i) => i % 50 === 0)) {
      const direct = colormapMetrics(parseHexColors(m.colors), { kind: m.kind, cyclic: m.group === 'cyclic' });
      assert.equal(hashOf(direct), hashOf(metrics(m)), m.name);
    }
  },
  SLOW,
);

test(
  'golden: viewData of every map, view and direction',
  () => {
    const all = cmapData.maps.map((m) =>
      [false, true].map((rev) => VIEW_KEYS.map((k) => ({ ...viewData(m, k, rev) }))),
    );
    assert.equal(hashOf(all), '0fa19a21a3ff79ea');
  },
  SLOW,
);

test('golden: interpolated colors and colorbar samples of every map', () => {
  const ts = Array.from({ length: 41 }, (_, i) => i / 40);
  const maps = cmapData.maps.map((m) => ({ name: m.name, kind: m.kind, rgbs: parseHexColors(m.colors) }));
  assert.equal(hashOf(maps.map((m) => ts.map((t) => cmapColorAt(m, t)))), 'f6533e03d42e2bb9');
  const samples = cmapData.maps.map((m) =>
    [false, true].map((reversed) => colormapSamples({ name: m.name, reversed }, 17)),
  );
  assert.equal(hashOf(samples), 'ed67dea30adbe5ac');
});

test(
  'golden: recolor and test-pattern LUTs of every map',
  () => {
    const N = 4096;
    const t = Float32Array.from({ length: N }, (_, i) => i / (N - 1) + (i % 3) * 1e-5);
    const index = { width: N, height: 1, t, de: new Float32Array(N) };
    const img = { width: N, height: 1, data: new Uint8ClampedArray(N * 4) };
    const maps = cmapData.maps.map((m) => ({ name: m.name, kind: m.kind, rgbs: parseHexColors(m.colors) }));
    // Bytes go into the hash as they are (JSON of 3 M numbers is slow).
    const recolored = createHash('sha256');
    for (const m of maps)
      for (const reversed of [false, true])
        recolored.update(recolorPixels(img, index, m, { reversed, tolerance: 1 }).data);
    assert.equal(recolored.digest('hex').slice(0, 16), '2c7597457a35baeb');
    const luts = createHash('sha256');
    for (const m of maps) luts.update(colorsLut(m.rgbs, m.kind === 'qualitative'));
    assert.equal(luts.digest('hex').slice(0, 16), '47423d7b290f204c');
  },
  SLOW,
);

test('golden: indexing composites transparent pixels on white', () => {
  const viridis = cmapData.maps.find((m) => m.name === 'viridis')!;
  const samples = colormapSamples({ name: 'viridis' }, 64)!;
  const rgbs = parseHexColors(viridis.colors);
  const n = 512;
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const c = rgbs[(i * 7) % rgbs.length];
    data.set([c[0], c[1], c[2], (i * 37) % 256], i * 4);
  }
  const ix = indexColors({ width: n, height: 1, data }, samples);
  assert.equal(hashOf([Array.from(ix.t), Array.from(ix.de)]), '3ccd8521972c7d0f');
});

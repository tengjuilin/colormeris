import assert from 'node:assert/strict';
import { test } from 'vitest';
import { colorsLut, paintValues, sinePattern } from './test-pattern.ts';

test('sinePattern stays in [0, 1] and has the expected shape', () => {
  const n = 65;
  const w = sinePattern(n, 'waves');
  assert.equal(w.length, n * n);
  assert.ok(w.every((v) => v >= 0 && v <= 1));
  assert.ok(Math.max(...w) > 1 - 1e-6 && Math.min(...w) < 1e-6); // stretched to the whole range
  // No repeats: the four quadrants differ.
  const q = (i0: number, j0: number) =>
    Array.from({ length: 32 }, (_, j) => Array.from({ length: 32 }, (_, i) => w[(j0 + j) * n + i0 + i])).flat();
  const diff = (a: number[], b: number[]) => a.reduce((s, v, k) => s + Math.abs(v - b[k]), 0) / a.length;
  assert.ok(diff(q(0, 0), q(32, 0)) > 0.1 && diff(q(0, 0), q(0, 32)) > 0.1 && diff(q(0, 0), q(32, 32)) > 0.1);

  const b = sinePattern(n, 'bumps');
  assert.ok(b.every((v) => v >= 0 && v <= 1));
  // Corners are (almost) the plain ramp; every bump top is 0.08 above it.
  assert.ok(b[0] < 1e-3 && Math.abs(b[n * n - 1] - 0.92) < 1e-3);
  const ramp = (i: number, j: number) => (0.92 * (i + j)) / (2 * (n - 1));
  for (const [i, j] of [
    [16, 16],
    [48, 16],
    [48, 48],
  ]) {
    // bump centers at n = 65
    const top = Math.max(
      ...[-1, 0, 1].flatMap((dj) => [-1, 0, 1].map((di) => b[(j + dj) * n + i + di] - ramp(i + di, j + dj))),
    );
    assert.ok(Math.abs(top - 0.08) < 0.005, `bump at ${i},${j}: ${top}`);
  }
});

test('colorsLut and paintValues map values to the colors', () => {
  const lut = colorsLut([
    [0, 0, 0],
    [255, 255, 255],
  ]);
  const px = paintValues(Float32Array.from([0, 0.5, 1]), lut);
  assert.deepEqual(Array.from(px.slice(0, 4)), [0, 0, 0, 255]);
  assert.ok(Math.abs(px[4] - 128) <= 1);
  assert.deepEqual(Array.from(px.slice(8, 12)), [255, 255, 255, 255]);
  // Qualitative: two equal bands, no blending.
  const q = paintValues(
    Float32Array.from([0.49, 0.51]),
    colorsLut(
      [
        [255, 0, 0],
        [0, 0, 255],
      ],
      true,
    ),
  );
  assert.deepEqual(Array.from(q), [255, 0, 0, 255, 0, 0, 255, 255]);
});

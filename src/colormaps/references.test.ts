import assert from 'node:assert/strict';
import { test } from 'vitest';
import { cmapData } from '../core/colormap-library.ts';
import { buildRefNumbers, CMAP_REFS } from './references.ts';

test('buildRefNumbers numbers keys by first use in list order', () => {
  const maps = [
    { name: 'cmr.ember', group: 'others', sub: 'x' },
    { name: 'cmo.thermal', group: 'sequential', sub: 'b' },
    { name: 'cmr.rainforest', group: 'sequential', sub: 'a' },
    { name: 'cmo.haline', group: 'sequential', sub: 'b' },
  ];
  // sequential first; sub 'b' (first seen) before 'a'; then others.
  assert.deepEqual(
    [...buildRefNumbers(maps)],
    [
      ['cmocean', 1],
      ['cmasher', 2],
    ],
  );
});

test('buildRefNumbers on the library: consecutive, known keys, each key once', () => {
  const nums = buildRefNumbers(cmapData.maps);
  assert.ok(nums.size > 5);
  assert.deepEqual(
    [...nums.values()],
    [...nums.values()].map((_, i) => i + 1),
  );
  for (const k of nums.keys()) assert.ok(CMAP_REFS[k], k);
});

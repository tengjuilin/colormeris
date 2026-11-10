import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readPixel } from './pixels.ts';
import { makeImage } from './testing.ts';

test('readPixel composites transparency on white', () => {
  const img = makeImage(1, 1, [0, 0, 0, 0]);
  assert.deepEqual(readPixel(img, 0, 0), [255, 255, 255]);
});

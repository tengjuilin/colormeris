import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  chroma,
  deltaE76,
  deltaE2000,
  hueAngle,
  labToRgb,
  lerpRgb,
  onWhite,
  parseHexColors,
  rgbToHex,
  rgbToLab,
} from './color.ts';

const close = (a: number, b: number, eps: number) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('white and black map to L=100 and L=0', () => {
  const w = rgbToLab([255, 255, 255]);
  close(w[0], 100, 1e-3);
  close(w[1], 0, 1e-2);
  close(w[2], 0, 1e-2);
  close(rgbToLab([0, 0, 0])[0], 0, 1e-6);
});

test('Lab round trip preserves RGB', () => {
  for (const rgb of [
    [12, 200, 90],
    [255, 0, 0],
    [68, 1, 84],
    [253, 231, 37],
  ]) {
    assert.deepEqual(labToRgb(rgbToLab(rgb)), rgb);
  }
});

test('CIEDE2000 matches Sharma et al. reference pairs', () => {
  close(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485]), 2.0425, 1e-4);
  close(deltaE2000([50, 2.5, 0], [73, 25, -18]), 27.1492, 1e-4);
  close(deltaE2000([2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514]), 0.9082, 1e-4);
});

test('deltaE76 is Euclidean', () => {
  close(deltaE76([0, 0, 0], [3, 4, 0]), 5, 1e-12);
});

test('rgbToHex', () => {
  assert.equal(rgbToHex([255, 0, 16]), '#ff0010');
});

test('onWhite, lerpRgb, chroma, hueAngle and parseHexColors', () => {
  assert.equal(onWhite(100, 1), 100);
  assert.equal(onWhite(100, 0), 255);
  assert.deepEqual(lerpRgb([0, 10, 20], [100, 10, 0], 0.25), [25, 10, 15]);
  assert.equal(chroma([50, 3, 4]), 5);
  assert.equal(hueAngle([50, 0, -1]), 270);
  assert.deepEqual(parseHexColors('ff0010000aff'), [
    [255, 0, 16],
    [0, 10, 255],
  ]);
});

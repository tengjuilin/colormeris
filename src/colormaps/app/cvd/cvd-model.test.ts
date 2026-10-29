import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import type { PixelImage } from '../../../types/index.ts';
import { caption, imagePixelAt, KEEP, readoutAt, shownTypes, simulateImage, TYPES } from './cvd-model.ts';

const img = (w: number, h: number, rgb: [number, number, number]): PixelImage => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return { width: w, height: h, data };
};
// jsdom/node have no ImageData; simulateImage only needs width, height and data.
const makeImage = (w: number, h: number) => img(w, h, [0, 0, 0]) as unknown as ImageData;

describe('captions and kinds', () => {
  test('shownTypes is one kind or all four', () => {
    assert.deepEqual(shownTypes('tritanopia'), ['tritanopia']);
    assert.deepEqual(
      shownTypes('all'),
      TYPES.map((t) => t[0]),
    );
  });

  test('caption names the model, the partial form and severity 0', () => {
    assert.equal(caption('deuteranopia', 1, 'recommended'), 'Deuteranopia (Machado 2009)');
    assert.equal(caption('deuteranopia', 0.5, 'brettel'), 'Deuteranomaly, severity 0.5 (Brettel 1997)');
    assert.equal(caption('protanopia', 0, 'recommended'), 'Protan, severity 0: normal vision');
    assert.match(caption('tritanopia', 1, 'vienot'), /Viénot 1999 has no tritan model/);
  });
});

describe('simulateImage', () => {
  const args = (cache: Map<string, ImageData>, extra = {}) => ({
    src: img(2, 2, [255, 0, 0]),
    kind: 'deuteranopia',
    model: 'recommended',
    severity: 1,
    cache,
    cancelled: () => false,
    makeImage,
    ...extra,
  });

  test('simulates and caches; a repeat returns the same image', async () => {
    const cache = new Map<string, ImageData>();
    const a = await simulateImage(args(cache));
    assert.ok(a);
    assert.equal(a.data[3], 0 + 255); // alpha kept
    assert.notEqual(a.data[1], 0); // red leaks into green for a deutan
    assert.equal(cache.size, 1);
    assert.equal(await simulateImage(args(cache)), a);
  });

  test('keeps the last KEEP results', async () => {
    const cache = new Map<string, ImageData>();
    for (let i = 0; i <= KEEP + 2; i++) await simulateImage(args(cache, { severity: i / 10 }));
    assert.equal(cache.size, KEEP);
    assert.ok(![...cache.keys()].some((k) => k.endsWith('|0')));
  });
});

describe('hover', () => {
  test('readoutAt gives the original and each simulation with ΔE2000', () => {
    const o = img(2, 2, [200, 30, 30]);
    const s = img(2, 2, [120, 120, 30]);
    const r = readoutAt(
      o,
      [
        { key: 'deuteranopia', data: s },
        { key: 'tritanopia', data: null },
      ],
      1,
      1,
    );
    assert.equal(r.origHex, '#c81e1e');
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].label, 'Deutan');
    assert.equal(r.items[0].hex, '#78781e');
    assert.ok(r.items[0].de > 10);
  });

  test('imagePixelAt maps the pointer into the image and refuses outside', () => {
    const box = { clientLeft: 1, clientTop: 1, clientWidth: 100, clientHeight: 50 };
    const rect = { left: 10, top: 20 };
    const im = img(200, 100, [0, 0, 0]);
    assert.deepEqual(imagePixelAt(11 + 50, 21 + 25, rect, box, im), { x: 100, y: 50 });
    assert.equal(imagePixelAt(5, 25, rect, box, im), null);
    assert.equal(imagePixelAt(111, 21, rect, box, im), null);
  });
});

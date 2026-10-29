import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { describeMatches, groupTies, ID_TIE, identifyMaps, wholeImagePixels } from './identify-model.ts';

const r = (name: string, score: number, reversed = false) => ({ name, score, reversed });

describe('groupTies', () => {
  test('matches within ID_TIE of the group lead share one entry', () => {
    const g = groupTies([r('gray', 1), r('gist_gray', 1 + ID_TIE / 2), r('binary', 1.5), r('x', 4)]);
    assert.equal(g.length, 3);
    assert.deepEqual(
      g[0].ties.map((t) => t.name),
      ['gist_gray'],
    );
    assert.equal(g[1].lead.name, 'binary');
  });

  test('stops at max groups', () => {
    const list = Array.from({ length: 9 }, (_, i) => r(`m${i}`, i));
    assert.equal(groupTies(list, 5).length, 5);
  });
});

describe('describeMatches', () => {
  test('null for no results, else the best and its level', () => {
    assert.equal(describeMatches([]), null);
    assert.equal(describeMatches([r('viridis', 0.4)])!.level, 'exact');
    assert.equal(describeMatches([r('viridis', 4)])!.level, 'close');
    assert.equal(describeMatches([r('viridis', 9)])!.level, 'none');
  });
});

test('identifyMaps lists the whole library once', () => {
  const a = identifyMaps();
  assert.ok(a.length > 100);
  assert.equal(identifyMaps(), a);
});

test('wholeImagePixels thins a large image to about 40000 pixels', () => {
  const w = 1000;
  const h = 800;
  const px = wholeImagePixels({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) });
  assert.ok(px.length <= 40000 * 1.2 && px.length > 10000, String(px.length));
});

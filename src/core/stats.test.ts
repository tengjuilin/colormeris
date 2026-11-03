import assert from 'node:assert/strict';
import { test } from 'vitest';
import { median, medianInPlace, pct, upperMedian } from './stats.ts';

test('median averages the middle pair and leaves its input alone', () => {
  const v = [5, 1, 4, 2];
  assert.equal(median(v), 3);
  assert.deepEqual(v, [5, 1, 4, 2]);
  assert.equal(median([3, 1, 2]), 2);
});

test('medianInPlace gives the same value and sorts its buffer', () => {
  const v = Float64Array.from([5, 1, 4, 2]);
  assert.equal(medianInPlace(v), 3);
  assert.deepEqual([...v], [1, 2, 4, 5]);
});

test('upperMedian is always an input value, 0 for none', () => {
  assert.equal(upperMedian([5, 1, 4, 2]), 4);
  assert.equal(upperMedian([]), 0);
});

test('pct rounds to a whole percentage', () => {
  assert.equal(pct(0.256), '26%');
});

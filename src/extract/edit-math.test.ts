import assert from 'node:assert/strict';
import { test } from 'vitest';
import { distanceToSegment, lockAxis, nextName, segmentProjection } from './edit-math.ts';

test('nextName takes the first free number', () => {
  assert.equal(nextName('ROI', []), 'ROI 1');
  assert.equal(nextName('ROI', ['ROI 1', 'ROI 3']), 'ROI 2');
  assert.equal(nextName('Profile', ['Profile 1', 'Profile 2', 'My line']), 'Profile 3');
  // Other prefixes do not count.
  assert.equal(nextName('Profile', ['ROI 1']), 'Profile 1');
});

test('lockAxis keeps the larger component only while locked', () => {
  assert.deepEqual(lockAxis(5, -3, false), { dx: 5, dy: -3 });
  assert.deepEqual(lockAxis(5, -3, true), { dx: 5, dy: 0 });
  assert.deepEqual(lockAxis(2, -3, true), { dx: 0, dy: -3 });
  // A tie moves across, as before.
  assert.deepEqual(lockAxis(4, 4, true), { dx: 4, dy: 0 });
});

test('segmentProjection: position along the segment (unclamped) and distance from its line', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  assert.deepEqual(segmentProjection({ x: 5, y: 3 }, a, b), { t: 0.5, across: 3 });
  assert.deepEqual(segmentProjection({ x: 15, y: -2 }, a, b), { t: 1.5, across: 2 });
  assert.deepEqual(segmentProjection({ x: 3, y: 4 }, a, a), { t: 0, across: 5 });
});

test('distanceToSegment measures to the nearest end beyond the segment', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  assert.equal(distanceToSegment({ x: 5, y: 3 }, a, b), 3);
  assert.equal(distanceToSegment({ x: 13, y: 4 }, a, b), 5);
  assert.equal(distanceToSegment({ x: -3, y: -4 }, a, b), 5);
  assert.equal(distanceToSegment({ x: 3, y: 4 }, a, a), 5);
});

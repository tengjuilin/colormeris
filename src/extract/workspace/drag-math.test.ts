import assert from 'node:assert/strict';
import { test } from 'vitest';
import { barTicksAfterDrag, dragRectCorner } from './drag-math.ts';

const box = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

test('dragRectCorner keeps a rectangle and the corner under the pointer', () => {
  const r = dragRectCorner(box, 0, { x: 2, y: 3 });
  assert.deepEqual(r.corners[2], { x: 10, y: 10 });
  assert.deepEqual(r.corners[r.i], { x: 2, y: 3 });
  assert.equal(r.i, 0);
  // Past the opposite corner the dragged corner becomes the bottom-right one.
  const past = dragRectCorner(box, 0, { x: 15, y: 14 });
  assert.equal(past.i, 2);
  assert.deepEqual(past.corners[0], { x: 10, y: 10 });
});

test('barTicksAfterDrag: follow keeps t, fixed keeps the distance from the other end', () => {
  const ts = [0, 0.5, 1];
  assert.deepEqual(barTicksAfterDrag(ts, 100, 200, 'end', 'follow'), ts);
  // Doubling the bar from its end: ticks stay where they were on the page.
  assert.deepEqual(barTicksAfterDrag(ts, 100, 200, 'end', 'fixed'), [0, 0.25, 0.5]);
  // Doubling it from its start: the same, measured from the end.
  assert.deepEqual(barTicksAfterDrag(ts, 100, 200, 'start', 'fixed'), [0.5, 0.75, 1]);
  // A zero-length bar gives finite numbers.
  assert.ok(barTicksAfterDrag([0.5], 100, 0, 'end', 'fixed').every(Number.isFinite));
});

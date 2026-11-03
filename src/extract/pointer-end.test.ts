import assert from 'node:assert/strict';
import { test } from 'vitest';
import { pointerEnd } from './pointer-end.ts';

const press = { moved: false, draw: false, handle: null, panOnly: false };

test('pointerEnd: a release drops a moved handle, ends a drawing, or clicks', () => {
  assert.equal(pointerEnd({ ...press, moved: true, handle: { kind: 'corner' } }), 'handleDrop');
  assert.equal(pointerEnd({ ...press, moved: true, draw: true }), 'drawEnd');
  assert.equal(pointerEnd(press), 'click');
  assert.equal(pointerEnd(press, { button: 1 }), null);
  assert.equal(pointerEnd({ ...press, panOnly: true }), null);
  assert.equal(pointerEnd({ ...press, moved: true }), null); // a pan
});

test('pointerEnd: a cancelled drag still drops, a cancelled press is no click', () => {
  assert.equal(pointerEnd({ ...press, moved: true, handle: { kind: 'corner' } }, { cancelled: true }), 'handleDrop');
  assert.equal(pointerEnd({ ...press, moved: true, draw: true }, { cancelled: true }), 'drawEnd');
  assert.equal(pointerEnd(press, { cancelled: true }), null);
  assert.equal(pointerEnd({ ...press, handle: { kind: 'corner' } }, { cancelled: true }), null);
});

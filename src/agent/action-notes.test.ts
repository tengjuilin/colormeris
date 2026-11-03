import assert from 'node:assert/strict';
import { test } from 'vitest';
import { makeImage, setPixel } from '../testing/helpers.ts';
import { averagePixel, colorbarNote, tickNote } from './action-notes.ts';

const given = { start: { x: 10.04, y: 100 }, end: { x: 10, y: 20.26 } };
const placed = { start: { x: 12, y: 98.5 }, end: { x: 12, y: 21 } };

test('colorbarNote: unsnapped, no strip, snapped, and ends without an edge', () => {
  assert.equal(colorbarNote({ snap: false, fit: null, given, placed, halfWidth: 3 }), 'Placed as given (no snapping).');
  assert.equal(
    colorbarNote({ snap: true, fit: null, given, placed, halfWidth: 3 }),
    'No colored strip was found under the line, so it was placed as given. Check that the line runs along the bar.',
  );
  const fit = { stripHalf: 4, found: { start: true, end: true } };
  assert.equal(
    colorbarNote({ snap: true, fit, given, placed, halfWidth: 3 }),
    'Snapped to the strip (9 px wide): start (10, 100) → (12, 98.5), end (10, 20.3) → (12, 21), halfWidth 3.',
  );
  const one = colorbarNote({
    snap: true,
    fit: { ...fit, found: { start: true, end: false } },
    given,
    placed,
    halfWidth: 3,
  });
  assert.match(one, / No clear edge was found near the end; it was only moved sideways\. Check it on a zoomed view\.$/);
  const both = colorbarNote({
    snap: true,
    fit: { ...fit, found: { start: false, end: false } },
    given,
    placed,
    halfWidth: 3,
  });
  assert.match(both, /near the start and end; they were only moved sideways\. Check them on/);
});

test('tickNote says how far the snap moved', () => {
  assert.equal(tickNote(false, null), 'Placed as given.');
  assert.equal(tickNote(true, { moved: -2 }), 'Snapped 2 px along the bar onto the tick mark.');
  assert.equal(tickNote(true, null), 'No tick mark found nearby; placed as given.');
});

test('averagePixel averages the square around a point', () => {
  const img = makeImage(5, 5, [0, 0, 0, 255]);
  setPixel(img, 2, 2, [90, 9, 255]);
  assert.deepEqual(averagePixel(img, 2, 2), [90, 9, 255]);
  assert.deepEqual(averagePixel(img, 2, 2, 1), [10, 1, 28]);
});

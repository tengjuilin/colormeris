import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  describeOldMap,
  downloadName,
  fillOverlay,
  hoverReadout,
  idleReadout,
  keyTarget,
  oldNoteParts,
  regionText,
} from './recolor-model.ts';
import { createValueStore } from './value-store.ts';

test('regionText', () => {
  assert.equal(regionText(0), 'Whole image');
  assert.equal(regionText(1), '1 region');
  assert.equal(regionText(3), '3 regions');
});

test('describeOldMap names an exact match, a reversed one, and no match', () => {
  const exact = describeOldMap({ name: 'viridis', score: 0.4, reversed: false }, true);
  assert.deepEqual(oldNoteParts(exact), { before: 'Old colormap: ', code: 'viridis', after: ' (ΔE 0.4).' });
  const rev = describeOldMap({ name: 'viridis', score: 0.4, reversed: true }, true);
  assert.equal(rev.flip, true);
  assert.match(oldNoteParts(rev).after, /read the other way\.$/);
  const none = describeOldMap({ name: 'x', score: 99, reversed: true }, false);
  assert.equal(none.flip, false); // an unknown map is read from the end where the line started
  const p = oldNoteParts(none);
  assert.match(p.before, /^The old colors match no known colormap \(best ΔE 99\.0\)/);
  assert.equal(p.code, '');
  assert.match(p.after, /could not be snapped/);
  assert.match(oldNoteParts(describeOldMap(undefined, true)).before, /best ΔE –/);
});

test('readout texts', () => {
  assert.equal(
    idleReadout(50, 200, false),
    '25% of the pixels have a color of the bar and are recolored. Hover a color to see where it is.',
  );
  assert.match(idleReadout(1, 1, true), /of the pixels in the regions/);
  assert.equal(hoverReadout(0.5, 10, 100, true, 0.02), ' At 50% of the bar: 10% of the pixels in the regions (±2%).');
});

test('keyTarget: arrows step by 1%, Shift by 10%, Home and End jump, other keys do nothing', () => {
  assert.equal(keyTarget('ArrowRight', 0.5, false), 0.51);
  assert.equal(keyTarget('ArrowLeft', 0.5, true), 0.4);
  assert.equal(keyTarget('Home', 0.5, false), 0);
  assert.equal(keyTarget('End', 0.5, false), 1);
  assert.equal(keyTarget('a', 0.5, false), null);
});

test('downloadName', () => {
  assert.equal(downloadName('fig', 'magma', false), 'fig-magma.png');
  assert.equal(downloadName('fig', 'magma', true), 'fig-magma_r.png');
});

test('fillOverlay: calm veils the rest, flash paints the complement of the shown color', () => {
  // 2 x 1 overlay on a 2 x 1 image; the first pixel is similar.
  const shown = [10, 20, 30, 255, 0, 0, 0, 255];
  const calm = new Uint32Array(2);
  fillOverlay(calm, Uint8Array.of(1, 0), true, shown, 1, 2, 2);
  assert.equal(calm[0], 0);
  assert.notEqual(calm[1], 0);
  const flash = new Uint32Array(2);
  fillOverlay(flash, Uint8Array.of(1, 0), false, shown, 1, 2, 2);
  assert.equal(flash[1], 0);
  // little-endian RGBA word: a, b, g, r from the top byte
  assert.equal(flash[0], ((255 << 24) | ((255 - 30) << 16) | ((255 - 20) << 8) | (255 - 10)) >>> 0);
});

test('a value store notifies on change only', () => {
  const s = createValueStore(1);
  let n = 0;
  const off = s.subscribe(() => n++);
  s.set(1);
  s.set(2);
  assert.equal(n, 1);
  off();
  s.set(3);
  assert.equal(n, 1);
  assert.equal(s.get(), 3);
});

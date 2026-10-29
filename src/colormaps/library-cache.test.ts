import assert from 'node:assert/strict';
import { test } from 'vitest';
import { cmapData } from '../core/colormap-library.ts';
import { base, isRev, metrics, notesOf, sepOf, viewData } from './library-cache.ts';

const viridis = cmapData.maps.find((m) => m.name === 'viridis')!;
const qual = cmapData.maps.find((m) => m.kind === 'qualitative')!;

test('isRev: the global Reversed and a map’s own flip cancel out', () => {
  const flipped = new Set(['a']);
  assert.equal(isRev({ reversed: false, flipped }, 'a'), true);
  assert.equal(isRev({ reversed: false, flipped }, 'b'), false);
  assert.equal(isRev({ reversed: true, flipped }, 'a'), false);
  assert.equal(isRev({ reversed: true, flipped }, 'b'), true);
});

test('base is parsed once and cached', () => {
  assert.equal(base(viridis), base(viridis));
  assert.ok(base(viridis).length > 2);
});

test('viewData: reversed runs the other way, caches, and adds L*', () => {
  const fwd = viewData(viridis, 'orig', false);
  const bwd = viewData(viridis, 'orig', true);
  assert.equal(viewData(viridis, 'orig', false), fwd);
  assert.deepEqual(bwd.colors, fwd.colors.slice().reverse());
  assert.equal(fwd.L?.length, fwd.colors.length);
  assert.equal(viewData(viridis, 'gray', false).colors.length, fwd.colors.length);
});

test('metrics and notes are cached per map', () => {
  assert.equal(metrics(viridis), metrics(viridis));
  assert.equal(notesOf(viridis), notesOf(viridis));
  assert.ok(notesOf(viridis).length > 0);
});

test('sepOf mirrors positions when reversed', () => {
  const s = sepOf(viridis, 'orig', false);
  const r = sepOf(viridis, 'orig', true);
  if (s && r) {
    assert.equal(r.min, s.min);
    assert.deepEqual(r.t, [1 - s.t[1], 1 - s.t[0]]);
  }
  const q = sepOf(qual, 'orig', false);
  const qr = sepOf(qual, 'orig', true);
  if (q && qr) {
    const n = base(qual).length;
    assert.deepEqual(qr.t, [n - 1 - q.t[1], n - 1 - q.t[0]]);
  }
});

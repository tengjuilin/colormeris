import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { Profile } from '../../types/index.ts';
import { reconcileSelection, selectInSet } from './selection.ts';

const prof = (...ids: string[]) => ids.map((id) => ({ id }) as Profile);

test('a lone profile is selected; removed ids are dropped; an overlay profile is promoted', () => {
  const a = { selectedId: null, overlay: new Set<string>() };
  reconcileSelection(a, prof('p1'));
  assert.equal(a.selectedId, 'p1');
  const b = { selectedId: 'gone', overlay: new Set(['p1', 'p2', 'zz']) };
  reconcileSelection(b, prof('p1', 'p2', 'p3'));
  assert.equal(b.selectedId, 'p2');
  assert.deepEqual([...b.overlay], ['p1']);
  const c = { selectedId: 'p1', overlay: new Set(['p1', 'p2']) };
  reconcileSelection(c, prof('p1', 'p2'));
  assert.deepEqual([...c.overlay], ['p2']);
  reconcileSelection(c, prof('p1', 'p2'));
  assert.equal(c.selectedId, 'p1');
});

test('selectInSet: a click selects one; Shift toggles, keeping the others plotted', () => {
  const sel = { selectedId: 'p1', overlay: new Set(['p2']) };
  selectInSet(sel, 'p3');
  assert.equal(sel.selectedId, 'p3');
  assert.equal(sel.overlay.size, 0);
  selectInSet(sel, 'p1', true);
  assert.equal(sel.selectedId, 'p1');
  assert.deepEqual([...sel.overlay], ['p3']);
  selectInSet(sel, 'p3', true); // an overlay profile is dropped
  assert.equal(sel.selectedId, 'p1');
  assert.equal(sel.overlay.size, 0);
  selectInSet(sel, 'p2', true);
  selectInSet(sel, 'p2', true); // the edited one: the last overlay profile takes its place
  assert.equal(sel.selectedId, 'p1');
  assert.equal(sel.overlay.size, 0);
  selectInSet(sel, 'p1', true);
  assert.equal(sel.selectedId, null);
  selectInSet(sel, null, true);
  assert.equal(sel.selectedId, null);
});

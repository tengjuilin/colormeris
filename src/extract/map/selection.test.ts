import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { Profile } from '../../types/index.ts';
import { reconcileSelection } from './selection.ts';

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

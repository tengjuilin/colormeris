import assert from 'node:assert/strict';
import { test } from 'vitest';
import { cmapData } from '../../../core/colormap-library.ts';
import {
  bestByColumn,
  cycleCmpSort,
  facts,
  groupRuns,
  isBest,
  NUM_COLS,
  reversedHere,
  sortFacts,
  visibleCols,
} from './compare-model.ts';
import { nearestSlot } from './drag-reorder.ts';

const get = (n: string) => facts(cmapData.maps.find((m) => m.name === n)!);

test('reversedHere flips the Browse direction once more', () => {
  assert.equal(reversedHere(false, new Set(), 'a'), false);
  assert.equal(reversedHere(true, new Set(), 'a'), true);
  assert.equal(reversedHere(true, new Set(['a']), 'a'), false);
  assert.equal(reversedHere(false, new Set(['a']), 'a'), true);
});

test('the sort cycles none, ascending, descending, none', () => {
  const a = cycleCmpSort(null, 'cv');
  assert.deepEqual(a, { id: 'cv', dir: 1 });
  assert.deepEqual(cycleCmpSort(a, 'cv'), { id: 'cv', dir: -1 });
  assert.equal(cycleCmpSort({ id: 'cv', dir: -1 }, 'cv'), null);
  assert.deepEqual(cycleCmpSort({ id: 'cv', dir: -1 }, 'max'), { id: 'max', dir: 1 });
});

test('sortFacts keeps the selection order without a sort, puts n/a last and breaks ties by order', () => {
  const rows = ['viridis', 'magma', 'Set1'].map(get);
  assert.equal(sortFacts(rows, null), rows);
  const names = (s: ReturnType<typeof sortFacts>) => s.map((f) => f.map.name);
  assert.deepEqual(names(sortFacts(rows, { id: 'name', dir: 1 })), ['magma', 'Set1', 'viridis']);
  assert.deepEqual(names(sortFacts(rows, { id: 'name', dir: -1 })), ['viridis', 'Set1', 'magma']);
  // Step CV is n/a for the qualitative map, whichever way the sort runs.
  assert.equal(names(sortFacts(rows, { id: 'cv', dir: 1 })).at(-1), 'Set1');
  assert.equal(names(sortFacts(rows, { id: 'cv', dir: -1 })).at(-1), 'Set1');
});

test('bestByColumn marks the best value, and nothing when all are equal or only one exists', () => {
  const cols = visibleCols(true);
  const rows = ['viridis', 'jet'].map(get);
  const best = bestByColumn(cols, rows);
  const cv = cols.find((c) => c.id === 'cv')!;
  assert.ok(best.cv != null);
  assert.equal(isBest(cv, get('viridis'), best), true);
  assert.equal(isBest(cv, get('jet'), best), false);
  assert.deepEqual(bestByColumn(cols, [get('viridis')]), {});
  assert.deepEqual(bestByColumn(cols, [get('viridis'), get('viridis')]), {});
});

test('visibleCols shows the key columns until all are asked for, and groups sit under one header', () => {
  assert.ok(visibleCols(false).length < NUM_COLS.length);
  assert.equal(visibleCols(true).length, NUM_COLS.length);
  assert.deepEqual(
    groupRuns(visibleCols(true)).map(([g, n]) => `${g}:${n}`),
    [':1', 'Lightness:3', 'Uniformity:2', 'Color vision:2', 'Readability:3', 'Ratings:1'],
  );
});

test('nearestSlot picks the row whose middle is closest', () => {
  assert.equal(nearestSlot([10, 50, 90], 0), 0);
  assert.equal(nearestSlot([10, 50, 90], 61), 1);
  assert.equal(nearestSlot([10, 50, 90], 80), 2);
});

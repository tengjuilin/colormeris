import assert from 'node:assert/strict';
import { test } from 'vitest';
import { COMPARE_MAX, parseViewerRoute } from '../route.ts';
import {
  cycleSort,
  filtering,
  initFromRoute,
  loadStripView,
  STRIP_VIEW_KEY,
  saveStripView,
  type ViewerAction,
  type ViewerState,
  viewerReducer,
} from './viewer-state.ts';

const names = ['viridis', 'jet', 'RdBu', 'gray', ...Array.from({ length: 12 }, (_, i) => `m${i}`)];
const start = (search = '', hash = '') => initFromRoute(parseViewerRoute(search, hash, names), { flipped: ['gray'] });
const run = (s: ViewerState, ...actions: ViewerAction[]) => actions.reduce(viewerReducer, s);

test('initFromRoute: tab, comparison, flipped maps; ?map= opens Browse and reveals', () => {
  const a = start();
  assert.equal(a.tab, 'browse');
  assert.deepEqual([...a.flipped], ['gray']);
  assert.equal(a.reveal, null);
  assert.equal(a.stripView, 'all');
  assert.deepEqual(start('?compare=jet,viridis').compare, ['jet', 'viridis']);
  assert.equal(start('?compare=jet,viridis').tab, 'compare');
  const b = start('?map=jet', '#identify');
  assert.equal(b.tab, 'browse');
  assert.equal(b.open, 'jet');
  assert.deepEqual(b.reveal, { name: 'jet', n: 1 });
  assert.equal(start('', '#cvd').tab, 'cvd');
  assert.equal(start('', '#ref-viridis').tab, 'browse');
  assert.equal(initFromRoute({ tab: 'browse', map: null, compare: [] }, { stripView: 'gray' }).stripView, 'gray');
});

test('GO_TAB: pushes history for a real change, ignores unknown tabs', () => {
  const s = start();
  const t = run(s, { type: 'GO_TAB', tab: 'recolor' });
  assert.equal(t.tab, 'recolor');
  assert.equal(t.history, 'push');
  assert.equal(run(t, { type: 'GO_TAB', tab: 'recolor' }).history, 'replace');
  assert.equal(run(s, { type: 'GO_TAB', tab: 'nope' }), s);
});

test('ROUTE_FROM_URL: tab null keeps the tab; query replaces open and compare', () => {
  const s = run(start(), { type: 'GO_TAB', tab: 'cvd' });
  const t = run(s, { type: 'ROUTE_FROM_URL', route: { tab: null, map: null, compare: ['jet'] } });
  assert.equal(t.tab, 'cvd');
  assert.deepEqual(t.compare, ['jet']);
  const u = run(t, { type: 'ROUTE_FROM_URL', route: { tab: 'compare', map: 'viridis', compare: [] } });
  assert.equal(u.tab, 'compare');
  assert.equal(u.open, 'viridis');
  assert.equal(u.history, 'replace');
});

test('OPEN sets and clears the open map', () => {
  const s = run(start(), { type: 'OPEN', name: 'jet' });
  assert.equal(s.open, 'jet');
  assert.equal(run(s, { type: 'OPEN', name: 'jet' }), s);
  assert.equal(run(s, { type: 'OPEN', name: null }).open, null);
});

test('SET_COMPARED enforces the cap, repeats and unknown removals', () => {
  let s = start();
  for (const n of names) s = run(s, { type: 'SET_COMPARED', name: n, on: true });
  assert.equal(s.compare.length, COMPARE_MAX);
  assert.deepEqual(s.compare, names.slice(0, COMPARE_MAX));
  assert.equal(run(s, { type: 'SET_COMPARED', name: 'm11', on: true }), s);
  assert.equal(run(s, { type: 'SET_COMPARED', name: 'viridis', on: true }), s);
  assert.equal(run(s, { type: 'SET_COMPARED', name: 'm11', on: false }), s);
  assert.ok(!run(s, { type: 'SET_COMPARED', name: 'jet', on: false }).compare.includes('jet'));
});

test('MOVE_COMPARED, REORDER_COMPARED and CLEAR_COMPARED', () => {
  const s = run(
    start(),
    ...['viridis', 'jet', 'RdBu'].map((name): ViewerAction => ({ type: 'SET_COMPARED', name, on: true })),
  );
  assert.deepEqual(run(s, { type: 'MOVE_COMPARED', name: 'viridis', d: 1 }).compare, ['jet', 'viridis', 'RdBu']);
  assert.equal(run(s, { type: 'MOVE_COMPARED', name: 'viridis', d: -1 }), s);
  assert.equal(run(s, { type: 'MOVE_COMPARED', name: 'RdBu', d: 1 }), s);
  assert.equal(run(s, { type: 'MOVE_COMPARED', name: 'nope', d: 1 }), s);
  assert.deepEqual(run(s, { type: 'REORDER_COMPARED', from: 0, to: 2 }).compare, ['jet', 'RdBu', 'viridis']);
  assert.deepEqual(run(s, { type: 'REORDER_COMPARED', from: 2, to: 0 }).compare, ['RdBu', 'viridis', 'jet']);
  assert.equal(run(s, { type: 'REORDER_COMPARED', from: 1, to: 1 }), s);
  assert.equal(run(s, { type: 'REORDER_COMPARED', from: 0, to: 3 }), s);
  assert.deepEqual(run(s, { type: 'CLEAR_COMPARED' }).compare, []);
  const same = start();
  assert.equal(run(same, { type: 'CLEAR_COMPARED' }), same);
  // The input is never mutated.
  assert.deepEqual(s.compare, ['viridis', 'jet', 'RdBu']);
});

test('reversing: Compare flips, Browse flips and the global Reversed are separate', () => {
  let s = run(start(), { type: 'TOGGLE_COMPARE_REV', name: 'jet' }, { type: 'TOGGLE_FLIP', name: 'jet' });
  assert.ok(s.compareFlipped.has('jet'));
  assert.ok(s.flipped.has('jet') && s.flipped.has('gray'));
  s = run(s, { type: 'TOGGLE_COMPARE_REV', name: 'jet' }, { type: 'TOGGLE_FLIP', name: 'gray' });
  assert.ok(!s.compareFlipped.has('jet'));
  assert.ok(!s.flipped.has('gray'));
  // Clearing the comparison keeps its flips, as the Compare tab does.
  const t = run(s, { type: 'TOGGLE_COMPARE_REV', name: 'jet' }, { type: 'CLEAR_COMPARED' });
  assert.ok(t.compareFlipped.has('jet'));
  assert.equal(run(s, { type: 'SET_REVERSED', on: true }).reversed, true);
});

test('SET_STRIP_VIEW accepts all and view keys only', () => {
  const s = start();
  assert.equal(run(s, { type: 'SET_STRIP_VIEW', view: 'gray' }).stripView, 'gray');
  assert.equal(run(s, { type: 'SET_STRIP_VIEW', view: 'protanopia' }).stripView, 'protanopia');
  assert.equal(run(s, { type: 'SET_STRIP_VIEW', view: 'nope' }), s);
  assert.equal(run(s, { type: 'SET_STRIP_VIEW', view: 'all' }), s);
});

test('strip view storage: loads valid values, survives a throwing store', () => {
  const store = new Map<string, string>();
  const fake = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  assert.equal(loadStripView(fake), 'all');
  saveStripView('gray', fake);
  assert.equal(store.get(STRIP_VIEW_KEY), 'gray');
  assert.equal(loadStripView(fake), 'gray');
  store.set(STRIP_VIEW_KEY, 'bogus');
  assert.equal(loadStripView(fake), 'all');
  const bad = {
    getItem: () => {
      throw new Error('x');
    },
    setItem: () => {
      throw new Error('x');
    },
  };
  assert.equal(loadStripView(bad), 'all');
  saveStripView('gray', bad);
});

test('sort cycles none -> best first -> reversed -> none, and restarts on another key', () => {
  let s = start();
  s = run(s, { type: 'SORT', key: 'name' });
  assert.deepEqual(s.sort, { key: 'name', dir: 1 });
  s = run(s, { type: 'SORT', key: 'name' });
  assert.deepEqual(s.sort, { key: 'name', dir: -1 });
  s = run(s, { type: 'SORT', key: 'name' });
  assert.equal(s.sort, null);
  s = run(s, { type: 'SORT', key: 'name' }, { type: 'SORT', key: 'cvd' });
  assert.deepEqual(s.sort, { key: 'cvd', dir: 1 });
  assert.deepEqual(cycleSort({ key: 'cvd', dir: -1 }, 'cvd'), null);
  assert.deepEqual(run(s, { type: 'SET_SORT', key: 'uniform' }).sort, { key: 'uniform', dir: 1 });
  assert.equal(run(s, { type: 'SET_SORT', key: 'default' }).sort, null);
  assert.equal(run(s, { type: 'SET_SORT', key: null }).sort, null);
});

test('query and filters: toggle, explicit on/off, clear, filtering()', () => {
  let s = start();
  assert.equal(filtering(s), false);
  s = run(s, { type: 'SET_QUERY', query: '  ' });
  assert.equal(filtering(s), false);
  s = run(s, { type: 'SET_QUERY', query: 'vir' });
  assert.equal(filtering(s), true);
  s = run(s, { type: 'SET_QUERY', query: '' });
  s = run(
    s,
    { type: 'TOGGLE_FILTER', kind: 'ratings', key: 'cvd' },
    { type: 'TOGGLE_FILTER', kind: 'sources', key: 'a' },
  );
  assert.deepEqual(s.filters, { ratings: ['cvd'], sources: ['a'] });
  assert.equal(filtering(s), true);
  assert.equal(run(s, { type: 'TOGGLE_FILTER', kind: 'sources', key: 'a', on: true }), s);
  assert.deepEqual(run(s, { type: 'TOGGLE_FILTER', kind: 'sources', key: 'a', on: false }).filters.sources, []);
  assert.deepEqual(run(s, { type: 'TOGGLE_FILTER', kind: 'ratings', key: 'cvd' }).filters.ratings, []);
  assert.deepEqual(run(s, { type: 'CLEAR_FILTERS' }).filters, { ratings: [], sources: [] });
});

test('SHOW_ROW: Browse, opens the map, reveals, clears filters only when they hide it', () => {
  let s = run(start(), { type: 'GO_TAB', tab: 'cvd' });
  s = run(s, { type: 'SET_QUERY', query: 'zzz' }, { type: 'TOGGLE_FILTER', kind: 'ratings', key: 'cvd' });
  const kept = run(s, { type: 'SHOW_ROW', name: 'jet', hidden: false });
  assert.equal(kept.tab, 'browse');
  assert.equal(kept.open, 'jet');
  assert.equal(kept.query, 'zzz');
  assert.deepEqual(kept.filters.ratings, ['cvd']);
  assert.equal(kept.history, 'push');
  assert.deepEqual(kept.reveal, { name: 'jet', n: 1 });
  const cleared = run(s, { type: 'SHOW_ROW', name: 'jet', hidden: true });
  assert.equal(cleared.query, '');
  assert.deepEqual(cleared.filters, { ratings: [], sources: [] });
  const again = run(cleared, { type: 'SHOW_ROW', name: 'jet', hidden: false });
  assert.deepEqual(again.reveal, { name: 'jet', n: 2 });
  assert.equal(again.history, 'replace'); // already on Browse
});

test('the reducer returns new objects and leaves the old state alone', () => {
  const s = start();
  const frozen = JSON.stringify({ ...s, flipped: [...s.flipped], compareFlipped: [...s.compareFlipped] });
  run(s, { type: 'SET_COMPARED', name: 'jet', on: true }, { type: 'TOGGLE_FLIP', name: 'jet' });
  assert.equal(JSON.stringify({ ...s, flipped: [...s.flipped], compareFlipped: [...s.compareFlipped] }), frozen);
});

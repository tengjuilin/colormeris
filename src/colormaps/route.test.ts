import assert from 'node:assert/strict';
import { test } from 'vitest';
import { cmapData } from '../core/colormap-library.ts';
import { COMPARE_MAX, formatViewerUrl, parseCompare, parseViewerRoute } from './route.ts';

test('parseCompare keeps known names once, in order, up to the cap', () => {
  const names = ['viridis', 'jet', 'RdBu', 'gray'];
  assert.deepEqual(parseCompare('jet,VIRIDIS, rdbu ,jet,nope,', names), ['jet', 'viridis', 'RdBu']);
  assert.deepEqual(parseCompare(null, names), []);
  assert.deepEqual(parseCompare('', names), []);
  assert.deepEqual(parseCompare('viridis,jet,gray', names, 2), ['viridis', 'jet']);
  const all = cmapData.maps.map((m) => m.name);
  assert.equal(parseCompare(all.join(','), all).length, COMPARE_MAX);
  assert.equal(COMPARE_MAX, 10);
});

test('parseViewerRoute: tab from the hash, map and comparison from the query', () => {
  const names = ['viridis', 'jet', 'RdBu'];
  assert.deepEqual(parseViewerRoute('', '', names), { tab: 'browse', map: null, compare: [] });
  assert.deepEqual(parseViewerRoute('?map=JET', '#browse', names), { tab: 'browse', map: 'jet', compare: [] });
  assert.equal(parseViewerRoute('?map=nope', '', names).map, null);
  // Old shared links have only ?compare=, so they open the comparison.
  assert.deepEqual(parseViewerRoute('?compare=jet,viridis', '', names), {
    tab: 'compare',
    map: null,
    compare: ['jet', 'viridis'],
  });
  assert.equal(parseViewerRoute('?compare=jet&map=rdbu', '', names).tab, 'browse');
  assert.equal(parseViewerRoute('?compare=jet', '#Identify', names).tab, 'identify');
  assert.equal(parseViewerRoute('', '#cvd', names).tab, 'cvd');
  // Reference links leave the tab alone.
  assert.equal(parseViewerRoute('', '#ref-viridis', names).tab, null);
});

test('formatViewerUrl: keeps other parameters and the hash, round-trips with parseViewerRoute', () => {
  const names = ['viridis', 'jet', 'RdBu', 'a b'];
  const loc = (search: string, hash: string) => ({ pathname: '/colormaps.html', search, hash });
  assert.equal(formatViewerUrl({ selected: [], open: null }, loc('', '#browse')), '/colormaps.html#browse');
  assert.equal(
    formatViewerUrl({ selected: ['jet', 'viridis'], open: 'RdBu' }, loc('', '#compare')),
    '/colormaps.html?compare=jet,viridis&map=RdBu#compare',
  );
  assert.equal(
    formatViewerUrl({ selected: ['jet'], open: null }, loc('?x=1&compare=old&map=old', '')),
    '/colormaps.html?x=1&compare=jet',
  );
  assert.equal(
    formatViewerUrl({ selected: [], open: 'a b' }, loc('?x=1', '#cvd')),
    '/colormaps.html?x=1&map=a%20b#cvd',
  );
  for (const tab of ['browse', 'compare', 'identify']) {
    const state = { selected: ['RdBu', 'a b', 'jet'], open: 'viridis' };
    const url = formatViewerUrl(state, loc('', `#${tab}`));
    const q = url.slice(url.indexOf('?'), url.indexOf('#'));
    assert.deepEqual(parseViewerRoute(q, `#${tab}`, names), { tab, map: 'viridis', compare: state.selected });
  }
});

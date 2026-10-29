import assert from 'node:assert/strict';
import { test } from 'vitest';
import { cmapData } from '../../../core/colormap-library.ts';
import { lightnessStats } from '../../../core/cvd.ts';
import type { ColormapEntry } from '../../../types/index.ts';
import { metrics, viewData } from '../../library-cache.ts';
import type { Filters } from '../viewer-state.ts';
import {
  buildTree,
  FILTERS,
  familyKeys,
  familyState,
  filterCount,
  isShown,
  SECTIONS,
  SORTS,
  sortNames,
} from './browse-model.ts';

const maps = cmapData.maps;
const none: Filters = { ratings: [], sources: [] };

test('SECTIONS, SORTS and FILTERS keep the old lists', () => {
  assert.deepEqual(
    SECTIONS.map((s) => s[0]),
    ['sequential', 'diverging', 'cyclic', 'rainbow', 'multi-sequential', 'qualitative', 'others'],
  );
  assert.ok(SECTIONS.every((s) => s[2] === false));
  assert.deepEqual(
    SORTS.map((s) => s[0]),
    ['default', 'name', 'uniform', 'cvd', 'gray', 'linear', 'readable'],
  );
  assert.deepEqual(
    FILTERS.map((f) => f[3]),
    ['uniform', 'cvdSafe', 'graySafe', 'readable'],
  );
});

test('buildTree: sections, sub-headings and start-open follow the old rules', () => {
  const tree = buildTree(maps);
  // The old code, written out again.
  const expected: { group: string; subs: { sub: string; startOpen: boolean; names: string[] }[] }[] = [];
  for (const [group] of SECTIONS) {
    const inGroup = maps.filter((m) => m.group === group);
    if (!inGroup.length) continue;
    const subs: string[] = [];
    for (const m of inGroup) if (!subs.includes(m.sub)) subs.push(m.sub);
    expected.push({
      group,
      subs: subs.map((sub) => {
        const rows = inGroup.filter((x) => x.sub === sub);
        return {
          sub,
          startOpen:
            group === 'sequential' ? /perceptually uniform/.test(sub) : rows.some((m) => m.source === 'matplotlib'),
          names: rows.map((r) => r.name),
        };
      }),
    });
  }
  assert.deepEqual(
    tree.map((t) => ({ group: t.group, subs: t.subs })),
    expected,
  );
  assert.equal(
    tree.flatMap((t) => t.subs.flatMap((s) => s.names)).length,
    maps.filter((m) => SECTIONS.some((s) => s[0] === m.group)).length,
  );
  assert.ok(tree.some((t) => t.subs.some((s) => s.startOpen)));
});

test('buildTree: a small library, empty sections left out', () => {
  const mk = (name: string, group: string, sub: string, source: string): ColormapEntry =>
    ({ name, group, sub, source, kind: 'continuous', colors: '' }) as ColormapEntry;
  const tree = buildTree([
    mk('a', 'diverging', 'S1', 'matplotlib'),
    mk('b', 'sequential', 'Matplotlib: perceptually uniform', 'x'),
    mk('c', 'sequential', 'Other', 'matplotlib'),
    mk('d', 'diverging', 'S2', 'y'),
    mk('e', 'diverging', 'S1', 'y'),
  ]);
  assert.deepEqual(
    tree.map((t) => t.group),
    ['sequential', 'diverging'],
  );
  assert.deepEqual(tree[0].subs, [
    { sub: 'Matplotlib: perceptually uniform', startOpen: true, names: ['b'] },
    { sub: 'Other', startOpen: false, names: ['c'] },
  ]);
  assert.deepEqual(tree[1].subs, [
    { sub: 'S1', startOpen: true, names: ['a', 'e'] },
    { sub: 'S2', startOpen: false, names: ['d'] },
  ]);
});

// The old SORT_KEYS comparators (browse-tab.ts), on maps.
const r2 = (m: ColormapEntry) =>
  m.kind === 'qualitative' ? -2 : (lightnessStats(viewData(m, 'orig', false).L as number[]).r2 ?? -1);
const OLD: Record<string, (a: ColormapEntry, b: ColormapEntry) => number> = {
  name: (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  uniform: (a, b) =>
    Number(metrics(a).rating.uniform == null) - Number(metrics(b).rating.uniform == null) ||
    metrics(a).stepStats.cv - metrics(b).stepStats.cv,
  cvd: (a, b) => metrics(b).cvdRatio - metrics(a).cvdRatio || metrics(b).cvdWorst - metrics(a).cvdWorst,
  gray: (a, b) => (metrics(b).separations.gray?.min ?? -1) - (metrics(a).separations.gray?.min ?? -1),
  linear: (a, b) => r2(b) - r2(a),
  readable: (a, b) => {
    const ra = metrics(a).readability;
    const rb = metrics(b).readability;
    if (!ra || !rb) return Number(ra == null) - Number(rb == null);
    return ra.orig.flat + ra.orig.ambiguous - (rb.orig.flat + rb.orig.ambiguous) || rb.orig.levels - ra.orig.levels;
  },
};

test('sortNames matches the old comparators, both directions, ties in library order', () => {
  const sample = maps.filter((_, i) => i % 3 === 0).slice(0, 60);
  const names = sample.map((m) => m.name);
  for (const key of Object.keys(OLD)) {
    for (const dir of [1, -1] as const) {
      const old = sample
        .map((m, i) => ({ m, i }))
        .sort((a, b) => OLD[key](a.m, b.m) * dir || a.i - b.i)
        .map((x) => x.m.name);
      assert.deepEqual(sortNames(names, { key, dir }, maps), old, `${key} ${dir}`);
    }
  }
});

test('sortNames: no sort or an unknown key is the library order; input is not changed', () => {
  const shuffled = maps
    .slice(0, 20)
    .map((m) => m.name)
    .reverse();
  const copy = shuffled.slice();
  const expected = maps.slice(0, 20).map((m) => m.name);
  assert.deepEqual(sortNames(shuffled, null, maps), expected);
  assert.deepEqual(sortNames(shuffled, { key: 'nope', dir: -1 }, maps), expected);
  assert.deepEqual(shuffled, copy);
});

test('isShown: query, ratings and sources', () => {
  const viridis = maps.find((m) => m.name === 'viridis') as ColormapEntry;
  assert.equal(isShown(viridis, '', none), true);
  assert.equal(isShown(viridis, '  VIRI ', none), true);
  assert.equal(isShown(viridis, 'jet', none), false);
  assert.equal(isShown(viridis, '', { ratings: [], sources: [viridis.source] }), true);
  assert.equal(isShown(viridis, '', { ratings: [], sources: ['no-such-source'] }), false);
  for (const [id, , , key] of FILTERS) {
    const yes = (metrics(viridis).rating as Record<string, unknown>)[key] === 'yes';
    assert.equal(isShown(viridis, '', { ratings: [id], sources: [] }), yes, id);
  }
  const jet = maps.find((m) => m.name === 'jet') as ColormapEntry;
  assert.equal(
    isShown(jet, '', { ratings: ['uniform'], sources: [] }),
    (metrics(jet).rating.uniform as unknown) === 'yes',
  );
});

test('familyKeys, filterCount and familyState: a fully ticked family counts once', () => {
  const sources = [
    { key: 'a', label: 'A', family: 'Py', version: '' },
    { key: 'b', label: 'B', family: 'Py', version: '' },
    { key: 'c', label: 'C', family: 'R', version: '' },
    { key: 'd', label: 'D', version: '' },
  ];
  assert.deepEqual(familyKeys(sources, 'Py'), ['a', 'b']);
  assert.equal(filterCount(none, sources), 0);
  assert.equal(filterCount({ ratings: ['uniform', 'cvd'], sources: ['a'] }, sources), 3);
  assert.equal(filterCount({ ratings: [], sources: ['a', 'b'] }, sources), 1);
  assert.equal(filterCount({ ratings: ['gray'], sources: ['a', 'b', 'c', 'd'] }, sources), 4);
  assert.deepEqual(familyState([], ['a', 'b']), { checked: false, indeterminate: false });
  assert.deepEqual(familyState(['a'], ['a', 'b']), { checked: false, indeterminate: true });
  assert.deepEqual(familyState(['a', 'b', 'x'], ['a', 'b']), { checked: true, indeterminate: false });
  assert.deepEqual(familyState(['a'], []), { checked: false, indeterminate: false });
});

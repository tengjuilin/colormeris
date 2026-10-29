// @vitest-environment jsdom
// The Browse tab with the real library (1063 maps): a sort click reorders the
// DOM without rendering a row, a search hides rows and updates the counts, the
// filters and Expand all work, and the markup the performance bench relies on
// is there.
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { type Dispatch, StrictMode, useReducer } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { stubIntersectionObserver } from '../../../testing/intersection-observer.ts';
import { createFocusRegistry, FocusRegistryContext } from '../focus-registry.ts';
import { DispatchContext } from '../viewer-context.ts';
import { initFromRoute, type ViewerAction, viewerReducer } from '../viewer-state.ts';
import { BrowseTab } from './browse-tab.tsx';
import { resetRowObserverForTests } from './use-row-visible.ts';

let rowRenders = 0;
vi.mock('./use-row-visible.ts', async (orig) => {
  const real = await orig<typeof import('./use-row-visible.ts')>();
  return {
    ...real,
    useRowVisible: (...args: Parameters<typeof real.useRowVisible>) => {
      rowRenders++;
      return real.useRowVisible(...args);
    },
  };
});

let io: ReturnType<typeof stubIntersectionObserver>;
beforeEach(() => {
  io = stubIntersectionObserver();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  resetRowObserverForTests();
  io.unstub();
  vi.restoreAllMocks();
});

let dispatchOut: Dispatch<ViewerAction>;
function Harness({ wide = false }: { wide?: boolean }) {
  const [s, dispatch] = useReducer(viewerReducer, undefined, () =>
    initFromRoute({ tab: 'browse', map: null, compare: [] }, { flipped: [] }),
  );
  dispatchOut = dispatch;
  return (
    <DispatchContext.Provider value={dispatch}>
      <BrowseTab
        tab={s.tab}
        open={s.open}
        compare={s.compare}
        reversed={s.reversed}
        flipped={s.flipped}
        stripView={s.stripView}
        sort={s.sort}
        query={s.query}
        filters={s.filters}
        reveal={s.reveal}
        wide={wide}
        topRef={null}
      />
    </DispatchContext.Provider>
  );
}
const registry = createFocusRegistry();
const mount = () =>
  render(
    <StrictMode>
      <FocusRegistryContext.Provider value={registry}>
        <Harness />
      </FocusRegistryContext.Provider>
    </StrictMode>,
  );
const names = (sub: Element) => [...sub.querySelectorAll('.cmap-item')].map((i) => (i as HTMLElement).dataset.name);

test('every map has a row at load, the bench selectors exist, the sections start closed', () => {
  const { container } = mount();
  assert.equal(container.querySelectorAll('.cmap-row').length, 1063);
  assert.equal(container.querySelectorAll('.cmap-item.built').length, 0);
  assert.ok(container.querySelector('.cmap-th[data-sort]'));
  assert.ok(container.querySelector('input.cmap-search'));
  const reversed = [...container.querySelectorAll('label')].find((l) => l.textContent?.trim() === 'Reversed');
  assert.ok(reversed?.querySelector('input[type=checkbox]'));
  assert.deepEqual(
    [...container.querySelectorAll<HTMLDetailsElement>('.cmap-section')].map((d) => d.open),
    Array(7).fill(false),
  );
  assert.equal(container.querySelector('#cmap-sec-sequential .cmap-count')!.textContent, '411');
});

test('a sort click reorders the rows and renders none of them; the second click reverses, the third restores', () => {
  const { container } = mount();
  const sub = container.querySelector('#cmap-sec-sequential .cmap-sub')!;
  const before = names(sub);
  const nameTh = container.querySelector<HTMLButtonElement>('.cmap-th[data-sort="name"]')!;
  const rowsBefore = rowRenders;
  fireEvent.click(nameTh);
  assert.equal(rowRenders, rowsBefore, 'no Row rendered');
  const az = names(sub);
  assert.deepEqual(
    az,
    [...before].sort((a, b) => (a as string).toLowerCase().localeCompare((b as string).toLowerCase())),
  );
  assert.equal(nameTh.dataset.dir, 'first');
  assert.equal(nameTh.getAttribute('aria-pressed'), 'true');
  assert.equal(container.querySelector<HTMLSelectElement>('select[aria-label="Sort colormaps"]')!.value, 'name');
  fireEvent.click(nameTh);
  assert.deepEqual(names(sub), [...az].reverse());
  assert.equal(nameTh.dataset.dir, 'last');
  fireEvent.click(nameTh);
  assert.deepEqual(names(sub), before);
  assert.equal(nameTh.getAttribute('aria-pressed'), 'false');
});

test('the Sort select picks a sort and the header follows', () => {
  const { container } = mount();
  fireEvent.change(container.querySelector('select[aria-label="Sort colormaps"]')!, { target: { value: 'name' } });
  assert.equal(container.querySelector<HTMLElement>('.cmap-th[data-sort="name"]')!.dataset.dir, 'first');
  fireEvent.change(container.querySelector('select[aria-label="Sort colormaps"]')!, { target: { value: 'default' } });
  assert.equal(container.querySelector('.cmap-th[aria-pressed="true"]'), null);
});

test('search hides the other rows, counts "n of total", opens sections with matches and restores them after', () => {
  const { container } = mount();
  const search = container.querySelector<HTMLInputElement>('.cmap-search')!;
  fireEvent.change(search, { target: { value: 'viridis' } });
  const shown = [...container.querySelectorAll<HTMLElement>('.cmap-item:not([hidden])')].map((i) => i.dataset.name);
  assert.ok(shown.length > 0 && shown.every((n) => n?.includes('viridis')));
  const seq = container.querySelector<HTMLDetailsElement>('#cmap-sec-sequential')!;
  assert.equal(seq.open, true);
  assert.equal(seq.querySelector('.cmap-count')!.textContent, `${shown.length} of 411`);
  assert.equal(container.querySelector<HTMLElement>('#cmap-sec-diverging')!.hidden, true);
  assert.equal(container.querySelector<HTMLElement>('.cmap-browse > p')!.hidden, true);
  fireEvent.change(search, { target: { value: 'zzzz' } });
  assert.equal(container.querySelector<HTMLElement>('.cmap-browse > p')!.hidden, false);
  fireEvent.change(search, { target: { value: '' } });
  assert.equal(container.querySelectorAll('.cmap-item[hidden]').length, 0);
  assert.equal(seq.open, false, 'back to what the user had');
  assert.equal(seq.querySelector('.cmap-count')!.textContent, '411');
});

test('a search renders no row: the list sets `hidden` on the DOM, and keeps it when a row builds', () => {
  const { container } = mount();
  const search = container.querySelector<HTMLInputElement>('.cmap-search')!;
  const before = rowRenders;
  fireEvent.change(search, { target: { value: 'viridis' } });
  assert.equal(rowRenders, before);
  const hidden = container.querySelectorAll('.cmap-item[hidden]').length;
  assert.ok(hidden > 1000);
  const item = container.querySelector<HTMLElement>('.cmap-item[data-name="jet"]')!;
  act(() => io.intersect(item));
  assert.ok(item.classList.contains('built'));
  assert.equal(item.hidden, true, 'building a hidden row does not show it');
});

test('names are unique ignoring case (the list finds rows by data-name)', () => {
  const { container } = mount();
  const n = [...container.querySelectorAll<HTMLElement>('.cmap-item')].map((i) => i.dataset.name);
  assert.equal(new Set(n).size, n.length);
});

test('Filters: a rating and a source count once each; a ticked family counts once; Clear empties them', () => {
  const { container } = mount();
  const filt = [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Filters'))!;
  assert.equal(filt.textContent, 'Filters');
  const pop = container.querySelector('#cmap-pop-filters')!;
  fireEvent.click(pop.querySelector('.cmap-filter-ratings input')!);
  assert.equal(filt.textContent, 'Filters (1)');
  assert.ok(filt.classList.contains('active'));
  const family = pop.querySelector<HTMLInputElement>('.cmap-filter-group label input')!;
  const group = pop.querySelectorAll('.cmap-filter-group')[0];
  const n = group.querySelectorAll('.cmap-filter-list input').length;
  assert.ok(n > 1);
  fireEvent.click(family);
  assert.equal(filt.textContent, 'Filters (2)', 'the whole family is one filter');
  assert.equal(group.querySelectorAll<HTMLInputElement>('.cmap-filter-list input:checked').length, n);
  fireEvent.click(group.querySelector('.cmap-filter-list input')!);
  assert.equal(filt.textContent, `Filters (${1 + n - 1})`);
  assert.equal(family.indeterminate, true);
  fireEvent.click([...pop.querySelectorAll('button')].find((b) => b.textContent === 'Clear')!);
  assert.equal(filt.textContent, 'Filters');
  assert.equal(pop.querySelectorAll('input:checked').length, 0);
});

test('a rating filter hides the maps not rated yes', () => {
  const { container } = mount();
  fireEvent.click(container.querySelector('#cmap-pop-filters .cmap-filter-ratings input')!); // Uniform
  const shown = container.querySelectorAll('.cmap-item:not([hidden])').length;
  assert.ok(shown > 0 && shown < 1063);
});

test('Expand all opens every fold in view and becomes Collapse all', async () => {
  const { container } = mount();
  const btn = [...container.querySelectorAll<HTMLButtonElement>('.cmap-controls > button')].find(
    (b) => b.textContent === 'Expand all',
  )!;
  fireEvent.click(btn);
  assert.ok([...container.querySelectorAll<HTMLDetailsElement>('.cmap-section, .cmap-sub')].every((d) => d.open));
  await vi.waitFor(() => assert.equal(btn.textContent, 'Collapse all'));
  fireEvent.click(btn);
  assert.ok([...container.querySelectorAll<HTMLDetailsElement>('.cmap-section, .cmap-sub')].every((d) => !d.open));
  await vi.waitFor(() => assert.equal(btn.textContent, 'Expand all'));
});

test('Reversed and the strip view reach the built rows; a tab other than Browse hides the bar and the list', () => {
  const { container } = mount();
  const seq = container.querySelector<HTMLDetailsElement>('#cmap-sec-sequential')!;
  seq.open = true;
  const item = container.querySelector<HTMLElement>('.cmap-item[data-name="viridis"]')!;
  act(() => io.intersect(item));
  const flip = item.querySelector('[data-act="rev"]')!;
  assert.equal(flip.getAttribute('aria-pressed'), 'false');
  const rev = [...container.querySelectorAll('label')]
    .find((l) => l.textContent?.trim() === 'Reversed')!
    .querySelector('input')!;
  fireEvent.click(rev);
  assert.equal(flip.getAttribute('aria-pressed'), 'true');
  fireEvent.click(container.querySelector('[data-view-key="gray"]')!);
  assert.deepEqual(
    [...item.querySelectorAll<HTMLElement>('.cmap-cell')].filter((c) => !c.hidden).map((c) => c.dataset.view),
    ['gray'],
  );
  assert.equal(container.querySelector('[data-view-key="gray"]')!.getAttribute('aria-pressed'), 'true');
  act(() => dispatchOut({ type: 'GO_TAB', tab: 'compare' }));
  assert.equal(container.querySelector<HTMLElement>('.cmap-controls')!.hidden, true);
  assert.equal(container.querySelector<HTMLElement>('.cmap-head')!.hidden, true);
  assert.equal(container.querySelector<HTMLElement>('.cmap-browse')!.hidden, true);
  assert.equal(container.querySelector('.cmap-viewtabs [aria-current]')!.textContent, 'Compare');
});

test('SHOW_ROW builds the map, opens its folds and opens its detail', () => {
  const { container } = mount();
  act(() => dispatchOut({ type: 'SHOW_ROW', name: 'jet', hidden: false }));
  const item = container.querySelector<HTMLElement>('.cmap-item[data-name="jet"]')!;
  assert.ok(item.classList.contains('built'));
  assert.ok(item.classList.contains('open'));
  assert.equal(item.closest<HTMLDetailsElement>('.cmap-sub')!.open, true);
  assert.equal(item.closest<HTMLDetailsElement>('.cmap-section')!.open, true);
  assert.equal(item.querySelector('.cmap-panel')!.hasAttribute('hidden'), false);
});

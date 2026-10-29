// @vitest-environment jsdom
// The link and the state, both ways: what is written (push only for a change
// from code, a missing hash added), and what the browser's link changes
// (hashchange, popstate, footer links).
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { type Dispatch, StrictMode, useReducer, useRef } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { parseViewerRoute } from '../route.ts';
import { useUrlSync } from './use-url-sync.ts';
import { initFromRoute, type ViewerAction, type ViewerState, viewerReducer } from './viewer-state.ts';

const names = ['viridis', 'jet', 'gray', 'magma'];
let latest: { s: ViewerState; dispatch: Dispatch<ViewerAction> };

function Harness() {
  const [s, dispatch] = useReducer(viewerReducer, undefined, () =>
    initFromRoute(parseViewerRoute(location.search, location.hash, names)),
  );
  latest = { s, dispatch };
  const footer = useRef<HTMLDetailsElement>(null);
  useUrlSync(s, dispatch, names, footer);
  return (
    <details ref={footer} id="cmap-about">
      <summary>About</summary>
      <a href="#ref-ciede2000">ref</a>
    </details>
  );
}
const mount = (url: string) => {
  history.replaceState(null, '', url);
  return render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
};
let push: ReturnType<typeof vi.spyOn>;
let replace: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  push = vi.spyOn(history, 'pushState');
  replace = vi.spyOn(history, 'replaceState');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const here = () => `${location.pathname}${location.search}${location.hash}`;

test('a link without a hash gets its tab, as a replacement', () => {
  mount('/colormaps.html');
  assert.equal(location.hash, '#browse');
  assert.equal(push.mock.calls.length, 0);
  cleanup();
  mount('/colormaps.html?compare=jet,gray');
  assert.equal(location.hash, '#compare');
  assert.equal(location.search, '?compare=jet,gray');
});

test('a link that is already right is not written', () => {
  mount('/colormaps.html#cvd');
  assert.equal(push.mock.calls.length, 0);
  // (the first call came from the setup's own replaceState)
  assert.equal(here(), '/colormaps.html#cvd');
});

test('a tab change from code pushes an entry; opening a map and comparing replace', () => {
  mount('/colormaps.html#browse');
  replace.mockClear();
  act(() => latest.dispatch({ type: 'GO_TAB', tab: 'cvd' }));
  assert.equal(push.mock.calls.length, 1);
  assert.equal(here(), '/colormaps.html#cvd');
  act(() => latest.dispatch({ type: 'OPEN', name: 'jet' }));
  assert.equal(push.mock.calls.length, 1);
  assert.equal(here(), '/colormaps.html?map=jet#cvd');
  act(() => latest.dispatch({ type: 'SET_COMPARED', name: 'gray', on: true }));
  assert.equal(push.mock.calls.length, 1);
  assert.equal(here(), '/colormaps.html?compare=gray&map=jet#cvd');
  act(() => latest.dispatch({ type: 'OPEN', name: null }));
  assert.equal(here(), '/colormaps.html?compare=gray#cvd');
});

test('SHOW_ROW from another tab pushes one entry with the map and Browse', () => {
  mount('/colormaps.html#identify');
  act(() => latest.dispatch({ type: 'SHOW_ROW', name: 'magma', hidden: false }));
  assert.equal(push.mock.calls.length, 1);
  assert.equal(here(), '/colormaps.html?map=magma#browse');
});

test('hashchange and popstate set the tab and write nothing back', () => {
  mount('/colormaps.html#browse');
  push.mockClear();
  replace.mockClear();
  history.replaceState(null, '', '/colormaps.html#compare');
  replace.mockClear();
  act(() => {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  assert.equal(latest.s.tab, 'compare');
  assert.equal(push.mock.calls.length, 0);
  assert.equal(replace.mock.calls.length, 0, 'the link already says it');
  // Back to an entry with another comparison and open map
  history.replaceState(null, '', '/colormaps.html?compare=gray,jet&map=viridis#browse');
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  assert.equal(latest.s.tab, 'browse');
  assert.deepEqual(latest.s.compare, ['gray', 'jet']);
  assert.equal(latest.s.open, 'viridis');
});

test('a #ref-… hash opens the footer and keeps the tab and the hash', () => {
  const { container } = mount('/colormaps.html#cvd');
  const footer = container.querySelector<HTMLDetailsElement>('#cmap-about')!;
  assert.equal(footer.open, false);
  history.replaceState(null, '', '/colormaps.html#ref-ciede2000');
  act(() => {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  assert.equal(footer.open, true);
  assert.equal(latest.s.tab, 'cvd');
  act(() => latest.dispatch({ type: 'OPEN', name: 'jet' }));
  assert.equal(location.hash, '#ref-ciede2000', 'the hash is not replaced by the tab');
});

test('?map=x#compare opens Browse and the hash follows, so the Compare link works', () => {
  mount('/colormaps.html?map=viridis#compare');
  assert.equal(latest.s.tab, 'browse');
  assert.equal(here(), '/colormaps.html?map=viridis#browse');
  history.replaceState(null, '', '/colormaps.html?map=viridis#compare');
  act(() => {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  assert.equal(latest.s.tab, 'compare');
});

test('Back onto a #ref-… entry restores its map and comparison and keeps the tab', () => {
  const { container } = mount('/colormaps.html#cvd');
  const footer = container.querySelector<HTMLDetailsElement>('#cmap-about')!;
  history.replaceState(null, '', '/colormaps.html?compare=gray&map=magma#ref-ciede2000');
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  assert.equal(footer.open, true);
  assert.equal(latest.s.tab, 'cvd');
  assert.equal(latest.s.open, 'magma');
  assert.deepEqual(latest.s.compare, ['gray']);
  assert.equal(location.hash, '#ref-ciede2000');
});

test('a click on a footer link opens the footer before the browser jumps', () => {
  const { container } = mount('/colormaps.html#browse');
  const footer = container.querySelector<HTMLDetailsElement>('#cmap-about')!;
  fireEvent.click(container.querySelector('a[href="#ref-ciede2000"]')!);
  assert.equal(footer.open, true);
});

test('listeners are removed on unmount', () => {
  const remove = vi.spyOn(window, 'removeEventListener');
  const { unmount } = mount('/colormaps.html#browse');
  unmount();
  const types = remove.mock.calls.map((c) => c[0]);
  assert.ok(types.includes('hashchange') && types.includes('popstate'));
});

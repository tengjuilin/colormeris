// @vitest-environment jsdom
// The detail drawer: drawer vs inline by `wide`, Escape (closes, asks for focus
// back, is left alone when taken), and the folds surviving a remount.
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { TooltipProvider } from '../shared/tooltip.tsx';
import { DetailDrawer, type DetailDrawerProps } from './detail-drawer.tsx';
import { createDetailFolds, DetailFoldsContext } from './detail-folds.ts';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const props = (over: Partial<DetailDrawerProps> = {}): DetailDrawerProps => ({
  open: 'viridis',
  wide: true,
  tab: 'browse',
  reversed: false,
  compared: false,
  compareFull: false,
  onClose: () => {},
  dispatch: () => {},
  ...over,
});
const ui = (p: DetailDrawerProps, folds = createDetailFolds()) => (
  <StrictMode>
    <DetailFoldsContext.Provider value={folds}>
      <TooltipProvider>
        <DetailDrawer {...p} />
      </TooltipProvider>
    </DetailFoldsContext.Provider>
  </StrictMode>
);
const aside = (c: HTMLElement) => c.querySelector<HTMLElement>('aside#cmap-drawer')!;

test('wide: the drawer shows the detail; not wide: it is hidden and empty', () => {
  const { container, rerender } = render(ui(props()));
  assert.equal(aside(container).hidden, false);
  assert.equal(aside(container).getAttribute('aria-label'), 'Colormap details');
  assert.equal(aside(container).querySelector('h2')!.textContent, 'viridis');
  rerender(ui(props({ wide: false })));
  assert.equal(aside(container).hidden, true);
  assert.equal(aside(container).children.length, 0);
});

test('hidden on other tabs and with nothing open', () => {
  const { container, rerender } = render(ui(props({ tab: 'compare' })));
  assert.equal(aside(container).hidden, true);
  rerender(ui(props({ open: null })));
  assert.equal(aside(container).hidden, true);
  assert.equal(aside(container).children.length, 0);
});

test('Escape closes: onClose gets the name, OPEN null is dispatched', () => {
  const onClose = vi.fn();
  const dispatch = vi.fn();
  render(ui(props({ onClose, dispatch })));
  fireEvent.keyDown(document.body, { key: 'Escape' });
  assert.deepEqual(onClose.mock.calls, [['viridis']]);
  assert.deepEqual(dispatch.mock.calls, [[{ type: 'OPEN', name: null }]]);
});

test('Escape also closes the inline detail (not wide), and the close button does', () => {
  const onClose = vi.fn();
  const dispatch = vi.fn();
  const { container } = render(ui(props({ wide: false, onClose, dispatch })));
  fireEvent.keyDown(document.body, { key: 'Escape' });
  assert.equal(dispatch.mock.calls.length, 1);
  cleanup();
  const wide = render(ui(props({ onClose, dispatch })));
  fireEvent.click(wide.container.querySelector('button[aria-label="Close details"]')!);
  assert.equal(onClose.mock.calls.length, 2);
  assert.equal(container.isConnected, false);
});

test('Escape is ignored when prevented, in a field or select, or with nothing open', () => {
  const dispatch = vi.fn();
  const { rerender } = render(
    <>
      <input id="q" />
      <select id="s">
        <option>a</option>
      </select>
      {ui(props({ dispatch }))}
    </>,
  );
  const prevent = (e: Event) => e.preventDefault();
  document.addEventListener('keydown', prevent, { once: true, capture: true });
  fireEvent.keyDown(document.body, { key: 'Escape' });
  assert.equal(dispatch.mock.calls.length, 0);
  fireEvent.keyDown(document.getElementById('q')!, { key: 'Escape' });
  fireEvent.keyDown(document.getElementById('s')!, { key: 'Escape' });
  fireEvent.keyDown(document.body, { key: 'Enter' });
  assert.equal(dispatch.mock.calls.length, 0);
  rerender(
    <>
      <input id="q" />
      {ui(props({ dispatch, open: null }))}
    </>,
  );
  fireEvent.keyDown(document.body, { key: 'Escape' });
  assert.equal(dispatch.mock.calls.length, 0);
});

test('folds persist across a remount of the drawer', () => {
  const folds = createDetailFolds();
  const first = render(ui(props(), folds));
  fireEvent.click(first.getByText('Expand all'));
  assert.ok(folds.has('views') && folds.has('zones') && folds.has('refs'));
  first.unmount();
  const second = render(ui(props(), folds));
  assert.ok([...second.container.querySelectorAll<HTMLDetailsElement>('details.cmap-fold')].every((d) => d.open));
  assert.ok(second.getByText('Collapse all'));
});

test('scrolls to the top for another map, not when the same map is shown again', () => {
  const { container, rerender } = render(ui(props()));
  const el = aside(container);
  el.scrollTop = 120;
  rerender(ui(props({ tab: 'compare' })));
  rerender(ui(props()));
  assert.equal(el.scrollTop, 120, 'another tab and back keeps the place');
  rerender(ui(props({ open: 'jet' })));
  assert.equal(el.scrollTop, 0);
});

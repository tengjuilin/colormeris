// @vitest-environment jsdom
// One Browse row: a shell until it is near the viewport or forced, then the full
// row; its buttons dispatch the right actions; the memo skips equal props.
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { stubIntersectionObserver } from '../../../testing/intersection-observer.ts';
import { createFocusRegistry, FocusRegistryContext } from '../focus-registry.ts';
import { Row, type RowProps, type RowView, RowViewContext } from './row.tsx';
import { resetRowObserverForTests } from './use-row-visible.ts';

let renders = 0;
vi.mock('./use-row-visible.ts', async (orig) => {
  const real = await orig<typeof import('./use-row-visible.ts')>();
  return {
    ...real,
    useRowVisible: (...args: Parameters<typeof real.useRowVisible>) => {
      renders++;
      return real.useRowVisible(...args);
    },
  };
});

let io: ReturnType<typeof stubIntersectionObserver>;
beforeEach(() => {
  renders = 0;
  io = stubIntersectionObserver();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  resetRowObserverForTests();
  io.unstub();
  vi.restoreAllMocks();
});

const props = (over: Partial<RowProps> = {}): RowProps => ({
  name: 'viridis',
  index: 0,
  compared: false,
  open: false,
  inline: false,
  forceBuild: 0,
  dispatch: () => {},
  ...over,
});
const NO_FLIPS: ReadonlySet<string> = new Set();
const view = (over: Partial<RowView> = {}): RowView => ({
  reversed: false,
  flipped: NO_FLIPS,
  stripView: 'all',
  compareFull: false,
  ...over,
});
const ui = (p: RowProps, registry = createFocusRegistry(), v = view()) => (
  <StrictMode>
    <FocusRegistryContext.Provider value={registry}>
      <RowViewContext.Provider value={v}>
        <details className="cmap-section">
          <details className="cmap-sub">
            <Row {...p} />
          </details>
        </details>
      </RowViewContext.Provider>
    </FocusRegistryContext.Provider>
  </StrictMode>
);
const item = (c: HTMLElement) => c.querySelector<HTMLElement>('.cmap-item')!;

test('a shell has the row and the hidden panel, nothing else', () => {
  const { container } = render(ui(props({ index: 4 })));
  const it = item(container);
  assert.equal(it.dataset.name, 'viridis');
  assert.equal(it.className, 'cmap-item');
  assert.equal(it.querySelector('.cmap-row')!.children.length, 0);
  const panel = it.querySelector<HTMLElement>('.cmap-panel')!;
  assert.equal(panel.id, 'cmap-panel-5');
  assert.equal(panel.hidden, true);
  assert.equal(it.querySelector('button'), null);
});

test('coming near the viewport builds the row: name, five strips, ratings, three buttons', () => {
  const { container } = render(ui(props()));
  act(() => io.intersect(item(container)));
  const it = item(container);
  assert.ok(it.classList.contains('built'));
  assert.equal(it.querySelector('.cmap-name-link')!.textContent, 'viridis');
  assert.equal(it.querySelectorAll('.cmap-cell').length, 5);
  assert.equal(it.querySelectorAll('.cmap-strip').length, 5);
  assert.equal(it.querySelectorAll('.cmap-rc').length, 4);
  assert.deepEqual(
    [...it.querySelectorAll('.cmap-actions button')].map((b) => b.getAttribute('aria-label') ?? b.className),
    ['Reverse viridis', 'cmap-toggle cmap-cmp', 'Details of viridis'],
  );
});

test('forceBuild builds at once and opens the folds the row sits in', () => {
  const { container } = render(ui(props({ forceBuild: 1 })));
  assert.ok(item(container).classList.contains('built'));
  assert.equal(container.querySelector<HTMLDetailsElement>('.cmap-sub')!.open, true);
  assert.equal(container.querySelector<HTMLDetailsElement>('.cmap-section')!.open, true);
});

test('single-view strips hide the other cells', () => {
  const { container } = render(ui(props({ forceBuild: 1 }), createFocusRegistry(), view({ stripView: 'gray' })));
  const shown = [...container.querySelectorAll<HTMLElement>('.cmap-cell')].filter((c) => !c.hidden);
  assert.deepEqual(
    shown.map((c) => c.dataset.view),
    ['gray'],
  );
});

test('the buttons dispatch: flip, compare, open; the name opens too', () => {
  const dispatch = vi.fn();
  const { container, rerender } = render(ui(props({ forceBuild: 1, dispatch })));
  fireEvent.click(container.querySelector('[data-act="rev"]')!);
  fireEvent.click(container.querySelector('.cmap-cmp')!);
  fireEvent.click(container.querySelector('.cmap-open-btn')!);
  fireEvent.click(container.querySelector('.cmap-name-link')!);
  assert.deepEqual(
    dispatch.mock.calls.map((c) => c[0]),
    [
      { type: 'TOGGLE_FLIP', name: 'viridis' },
      { type: 'SET_COMPARED', name: 'viridis', on: true },
      { type: 'OPEN', name: 'viridis' },
      { type: 'OPEN', name: 'viridis' },
    ],
  );
  // compared and open: the same buttons take it back
  dispatch.mockClear();
  rerender(ui(props({ forceBuild: 1, dispatch, compared: true, open: true })));
  fireEvent.click(container.querySelector('.cmap-cmp')!);
  fireEvent.click(container.querySelector('.cmap-open-btn')!);
  assert.deepEqual(
    dispatch.mock.calls.map((c) => c[0]),
    [
      { type: 'SET_COMPARED', name: 'viridis', on: false },
      { type: 'OPEN', name: null },
    ],
  );
});

test('a full comparison disables the button of a map that is not in it', () => {
  const registry = createFocusRegistry();
  const full = view({ compareFull: true });
  const { container, rerender } = render(ui(props({ forceBuild: 1 }), registry, full));
  const btn = container.querySelector<HTMLButtonElement>('.cmap-cmp')!;
  assert.equal(btn.disabled, true);
  assert.equal(btn.title, 'Up to 10 maps can be compared');
  rerender(ui(props({ forceBuild: 1, compared: true }), registry, full));
  assert.equal(btn.disabled, false);
  assert.equal(btn.title, 'Remove viridis from comparison');
});

test('open: in the drawer the panel stays hidden and the button points at the drawer; inline it shows the detail', () => {
  const { container, rerender } = render(ui(props({ open: true, inline: false })));
  const panel = container.querySelector<HTMLElement>('.cmap-panel')!;
  const btn = container.querySelector('.cmap-open-btn')!;
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(btn.getAttribute('aria-controls'), 'cmap-drawer');
  assert.equal(panel.hidden, true);
  assert.equal(panel.children.length, 0);
  rerender(ui(props({ open: true, inline: true })));
  assert.equal(btn.getAttribute('aria-controls'), panel.id);
  assert.equal(panel.hidden, false);
  assert.equal(panel.querySelector('h2')!.textContent, 'viridis');
});

test('inline close asks for focus back and dispatches OPEN null', () => {
  const dispatch = vi.fn();
  const registry = createFocusRegistry();
  const { container } = render(ui(props({ open: true, inline: true, dispatch }), registry));
  assert.ok(registry.buttons.get('viridis'));
  fireEvent.click(container.querySelector('[aria-label="Close details"]')!);
  assert.equal(registry.returnTo, 'viridis');
  assert.deepEqual(dispatch.mock.calls.at(-1)?.[0], { type: 'OPEN', name: null });
});

test('the direction comes from the view: global Reversed and a flip cancel out', () => {
  const registry = createFocusRegistry();
  const { container, rerender } = render(ui(props({ forceBuild: 1 }), registry, view({ reversed: true })));
  const flip = container.querySelector('[data-act="rev"]')!;
  assert.equal(flip.getAttribute('aria-pressed'), 'true');
  rerender(ui(props({ forceBuild: 1 }), registry, view({ reversed: true, flipped: new Set(['viridis']) })));
  assert.equal(flip.getAttribute('aria-pressed'), 'false');
});

test('the memo skips a render for equal props; a view change renders built rows but not shells', () => {
  const dispatch = () => {};
  const registry = createFocusRegistry();
  const v = view();
  const { container, rerender } = render(ui(props({ dispatch }), registry, v));
  const first = renders;
  rerender(ui(props({ dispatch }), registry, v));
  assert.equal(renders, first, 'equal props: no render');
  rerender(ui(props({ dispatch }), registry, view({ reversed: true })));
  assert.equal(renders, first, 'a shell does not render for the view');
  rerender(ui(props({ dispatch, compared: true }), registry, v));
  assert.ok(renders > first, 'compared changed: render');
  assert.ok(item(container).classList.contains('compared'));
});

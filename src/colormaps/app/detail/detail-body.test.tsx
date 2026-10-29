// @vitest-environment jsdom
// The detail body: structure, focus, the comparison button, Expand all, the
// pair marks and the remembered folds. Canvases and the 2D context are stubbed.
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cmapData } from '../../../core/colormap-library.ts';
import { TooltipProvider } from '../shared/tooltip.tsx';
import { DetailBody, type DetailBodyProps } from './detail-body.tsx';
import { createDetailFolds, DetailFoldsContext } from './detail-folds.ts';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const entry = (name: string) => cmapData.maps.find((m) => m.name === name)!;
const props = (over: Partial<DetailBodyProps> = {}): DetailBodyProps => ({
  map: entry('viridis'),
  reversed: false,
  compared: false,
  compareFull: false,
  onClose: () => {},
  dispatch: () => {},
  ...over,
});
const ui = (p: DetailBodyProps, folds = createDetailFolds()) => (
  <StrictMode>
    <DetailFoldsContext.Provider value={folds}>
      <TooltipProvider>
        <DetailBody {...p} />
      </TooltipProvider>
    </DetailFoldsContext.Provider>
  </StrictMode>
);

test('structure: head, five strips, notes, four plots, three folds', () => {
  const { container } = render(ui(props()));
  const h2 = container.querySelector('h2')!;
  assert.equal(h2.getAttribute('tabindex'), '-1');
  assert.equal(h2.textContent, 'viridis');
  assert.equal(document.activeElement, h2);
  assert.equal(container.querySelectorAll('.cmap-detail-strips .cmap-strip').length, 5);
  assert.equal(container.querySelectorAll('.cmap-detail-strips .cmap-cap-side').length, 5);
  assert.ok(container.querySelectorAll('ul.cmap-notes li').length >= 3);
  assert.equal(container.querySelectorAll('.cmap-detail-plots .cmap-plot').length, 4);
  assert.deepEqual(
    [...container.querySelectorAll('.cmap-fold > summary')].map((s) => s.textContent),
    ['Numbers: lightness and per view', 'Where values get confused', 'References'],
  );
  assert.equal(container.querySelectorAll('table.cmap-sep tbody tr').length, 5);
  assert.ok(container.querySelectorAll('ol.cmap-detail-refs li').length >= 1);
  assert.equal(container.querySelector('ol.cmap-detail-refs li')!.hasAttribute('id'), false);
});

test('a qualitative map has no step plot and no zones fold', () => {
  const { container } = render(ui(props({ map: entry('tab10') })));
  assert.equal(container.querySelectorAll('.cmap-detail-plots .cmap-plot').length, 3);
  assert.ok(![...container.querySelectorAll('.cmap-fold > summary')].some((s) => /confused/.test(s.textContent!)));
  assert.ok(container.querySelector('ul.cmap-notes li.muted'));
});

test('the comparison button dispatches, shows its state and is disabled at the cap', () => {
  const dispatch = vi.fn();
  const { container, rerender } = render(ui(props({ dispatch })));
  const btn = () => container.querySelector<HTMLButtonElement>('button[aria-pressed]:not(.cmap-tabs button)')!;
  assert.equal(btn().textContent, 'Add to comparison');
  fireEvent.click(btn());
  assert.deepEqual(dispatch.mock.calls[0][0], { type: 'SET_COMPARED', name: 'viridis', on: true });
  rerender(ui(props({ dispatch, compared: true })));
  assert.equal(btn().textContent, 'In comparison ✓');
  assert.equal(btn().getAttribute('aria-pressed'), 'true');
  fireEvent.click(btn());
  assert.deepEqual(dispatch.mock.calls[1][0], { type: 'SET_COMPARED', name: 'viridis', on: false });
  rerender(ui(props({ dispatch, compareFull: true })));
  assert.equal(btn().disabled, true);
  assert.match(btn().title, /Up to 10 maps/);
  rerender(ui(props({ dispatch, compared: true, compareFull: true })));
  assert.equal(btn().disabled, false);
});

test('Close calls back', () => {
  const onClose = vi.fn();
  const { container } = render(ui(props({ onClose })));
  fireEvent.click(container.querySelector('button[aria-label="Close details"]')!);
  assert.equal(onClose.mock.calls.length, 1);
});

test('Expand all opens every fold and turns into Collapse all', () => {
  const { container, getByText } = render(ui(props()));
  const folds = () => [...container.querySelectorAll<HTMLDetailsElement>('details.cmap-fold')];
  const btn = getByText('Expand all');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  fireEvent.click(btn);
  assert.ok(folds().every((d) => d.open));
  assert.equal(btn.textContent, 'Collapse all');
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  fireEvent.click(btn);
  assert.ok(folds().every((d) => !d.open));
  assert.equal(btn.textContent, 'Expand all');
});

test('opening one fold by hand counts toward Collapse all', () => {
  const { container, getByText } = render(ui(props({ map: entry('tab10') })));
  const folds = [...container.querySelectorAll<HTMLDetailsElement>('details.cmap-fold')];
  for (const d of folds) {
    d.open = true;
    fireEvent(d, new Event('toggle'));
  }
  assert.ok(getByText('Collapse all'));
});

test('hovering a table row marks the pair on that view strip, leaving removes it', () => {
  const { container } = render(ui(props()));
  const rows = container.querySelectorAll('table.cmap-sep tbody tr');
  const strips = container.querySelectorAll('.cmap-detail-strips .cmap-strip');
  fireEvent.pointerEnter(rows[2]);
  assert.equal(strips[2].querySelectorAll('.cmap-marker.cmap-pair').length, 2);
  assert.equal(container.querySelectorAll('.cmap-pair').length, 2);
  assert.match((strips[2].querySelector('.cmap-pair') as HTMLElement).style.left, /%$/);
  fireEvent.pointerLeave(rows[2]);
  assert.equal(container.querySelectorAll('.cmap-pair').length, 0);
});

test('folds are remembered across a remount and another map', () => {
  const folds = createDetailFolds();
  const first = render(ui(props(), folds));
  const sum = [...first.container.querySelectorAll('summary')].find((s) => /Numbers/.test(s.textContent!))!;
  const d = sum.parentElement as HTMLDetailsElement;
  d.open = true;
  fireEvent(d, new Event('toggle'));
  assert.equal(folds.has('views'), true);
  first.unmount();
  const second = render(ui(props({ map: entry('magma') }), folds));
  const open = [...second.container.querySelectorAll<HTMLDetailsElement>('details.cmap-fold')].map((x) => x.open);
  assert.deepEqual(open, [true, false, false]);
});

test('a detail created anew for the same map (a move between drawer and list) does not take focus again', async () => {
  const { container, rerender, unmount } = render(<div key="a">{ui(props())}</div>);
  const h2 = container.querySelector('h2') as HTMLElement;
  assert.equal(document.activeElement, h2);
  h2.blur();
  rerender(<section key="b">{ui(props())}</section>); // old subtree removed, new one added at once
  assert.notEqual(document.activeElement, container.querySelector('h2'));
  // Closed, then opened again: the name takes focus.
  unmount();
  await Promise.resolve();
  const again = render(ui(props()));
  assert.equal(document.activeElement, again.container.querySelector('h2'));
});

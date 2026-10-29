// @vitest-environment jsdom
// The Compare tab and tray: structure, the callbacks, focus after a change, the
// deferred build while hidden. Canvases and the 2D context are stubbed.
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { CompareTab, type CompareTabProps } from './compare-tab.tsx';
import { CompareTray } from './compare-tray.tsx';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const props = (over: Partial<CompareTabProps> = {}): CompareTabProps => ({
  active: true,
  compare: ['viridis', 'magma', 'jet'],
  compareFlipped: new Set(),
  browseRev: [false, false, false],
  stripView: 'all',
  onCompareChange: () => {},
  onToggleFlip: () => {},
  ...over,
});
const ui = (p: CompareTabProps) => (
  <StrictMode>
    <CompareTab {...p} />
  </StrictMode>
);

test('nothing is built until the tab is shown, and a change while hidden waits', () => {
  const { container, rerender } = render(ui(props({ active: false })));
  assert.equal(container.innerHTML, '');
  rerender(ui(props()));
  assert.equal(container.querySelector('#cmap-compare-count')!.textContent, 'Comparing 3 of up to 10');
  rerender(ui(props({ active: false, compare: ['viridis'] })));
  assert.equal(container.querySelector('#cmap-compare-count')!.textContent, 'Comparing 3 of up to 10');
  rerender(ui(props({ compare: ['viridis'] })));
  assert.equal(container.querySelector('#cmap-compare-count')!.textContent, 'Comparing 1 of up to 10');
});

test('structure: rows, plots host, table, sine images', () => {
  const { container } = render(ui(props()));
  assert.equal(container.querySelectorAll('.cmap-compare-rows .cmap-item').length, 3);
  assert.equal(container.querySelectorAll('.cmap-head [data-view]').length, 5);
  assert.equal(container.querySelectorAll('.cmap-strip').length, 15);
  assert.equal(container.querySelectorAll('.cmap-plot').length, 4);
  assert.equal(container.querySelectorAll('.cmap-legend li').length, 3);
  assert.equal(container.querySelectorAll('table.cmap-nums tbody tr').length, 3);
  assert.equal(container.querySelectorAll('canvas.cmap-sine-img').length, 3);
  assert.equal(container.querySelector<HTMLElement>('.cmap-compare-body')!.hidden, false);
  assert.equal(container.querySelector<HTMLElement>('p.muted')!.hidden, true);
});

test('empty: the hint shows, the body and the buttons are off', () => {
  const { container } = render(ui(props({ compare: [], browseRev: [] })));
  assert.equal(container.querySelector('#cmap-compare-count')!.textContent, 'Compare');
  assert.equal(container.querySelector<HTMLElement>('p.muted')!.hidden, false);
  assert.equal(container.querySelector<HTMLElement>('.cmap-compare-body')!.hidden, true);
  assert.deepEqual(
    [...container.querySelectorAll<HTMLButtonElement>('.cmap-compare-head button')].map((b) => b.disabled),
    [true, true],
  );
});

test('remove, move, reverse and Clear call back; the removed row hands focus to the next', () => {
  const onCompareChange = vi.fn();
  const onToggleFlip = vi.fn();
  const { container, rerender } = render(ui(props({ onCompareChange, onToggleFlip })));
  fireEvent.click(container.querySelector('button[data-act="remove"][data-name="magma"]')!);
  assert.deepEqual(onCompareChange.mock.calls[0][0], ['viridis', 'jet']);
  // the parent applies it
  rerender(ui(props({ onCompareChange, onToggleFlip, compare: ['viridis', 'jet'], browseRev: [false, false] })));
  fireEvent.keyDown(container.querySelector('button[data-act="drag"][data-name="viridis"]')!, { key: 'ArrowDown' });
  assert.deepEqual(onCompareChange.mock.calls[1][0], ['jet', 'viridis']);
  fireEvent.keyDown(container.querySelector('button[data-act="drag"][data-name="viridis"]')!, { key: 'ArrowUp' });
  assert.equal(onCompareChange.mock.calls.length, 2); // already first: nothing to do
  fireEvent.click(container.querySelector('button[data-act="rev"][data-name="jet"]')!);
  assert.deepEqual(onToggleFlip.mock.calls, [['jet']]);
  fireEvent.click([...container.querySelectorAll('.cmap-compare-head button')][0]);
  assert.deepEqual(onCompareChange.mock.calls[2][0], []);
});

function Host() {
  const [compare, setCompare] = useState<readonly string[]>(['viridis', 'magma', 'jet']);
  return ui(props({ compare, browseRev: compare.map(() => false), onCompareChange: setCompare }));
}

test('removing a row focuses the one that takes its place', () => {
  const { container } = render(<Host />);
  fireEvent.click(container.querySelector('button[data-act="remove"][data-name="viridis"]')!);
  assert.equal(document.activeElement, container.querySelector('button[data-act="remove"][data-name="magma"]'));
  fireEvent.click(container.querySelector('button[data-act="remove"][data-name="jet"]')!);
  assert.equal(document.activeElement, container.querySelector('button[data-act="remove"][data-name="magma"]'));
  fireEvent.click(container.querySelector('button[data-act="remove"][data-name="magma"]')!);
  assert.equal(document.activeElement, container.querySelector('#cmap-compare-count'));
});

test('reversed rows: flipped here on top of Browse; the button says so', () => {
  const { container } = render(ui(props({ compareFlipped: new Set(['jet']), browseRev: [false, true, true] })));
  const pressed = (n: string) =>
    container.querySelector(`button[data-act="rev"][data-name="${n}"]`)!.getAttribute('aria-pressed');
  assert.deepEqual(['viridis', 'magma', 'jet'].map(pressed), ['false', 'true', 'false']);
});

test('the strip view hides the other views', () => {
  const { container } = render(ui(props({ stripView: 'gray' })));
  const hidden = [...container.querySelectorAll<HTMLElement>('.cmap-item .cmap-row .cmap-cell')].map((c) => c.hidden);
  assert.deepEqual(hidden.slice(0, 5), [true, true, true, true, false]);
});

test('the numbers table sorts on a header click and All numbers adds columns', () => {
  const { container } = render(ui(props()));
  const cols = () => container.querySelectorAll('table.cmap-nums thead tr:last-child th').length;
  const before = cols();
  fireEvent.click(container.querySelector('th[data-col="name"] button')!);
  assert.equal(container.querySelector('th[data-col="name"]')!.getAttribute('aria-sort'), 'ascending');
  assert.deepEqual(
    [...container.querySelectorAll('table.cmap-nums tbody th code')].map((c) => c.textContent),
    ['jet', 'magma', 'viridis'],
  );
  fireEvent.click(container.querySelector('th[data-col="name"] button')!);
  fireEvent.click(container.querySelector('th[data-col="name"] button')!);
  assert.equal(container.querySelector('th[data-col="name"]')!.getAttribute('aria-sort'), 'none');
  fireEvent.click([...container.querySelectorAll('.cmap-nums-head button')][0]);
  assert.ok(cols() > before);
});

test('the picker is disabled with 10 maps', () => {
  const names = ['viridis', 'magma', 'jet', 'plasma', 'inferno', 'cividis', 'turbo', 'Greys', 'Blues', 'Reds'];
  const { container } = render(ui(props({ compare: names, browseRev: names.map(() => false) })));
  assert.equal(container.querySelector<HTMLInputElement>('.cmap-compare-add input')!.disabled, true);
});

test('the tray lists chips, removes one and clears', () => {
  const onCompareChange = vi.fn();
  const { container } = render(
    <StrictMode>
      <CompareTray
        compare={['viridis', 'jet']}
        browseRev={[false, true]}
        compareFlipped={new Set(['jet'])}
        onCompareChange={onCompareChange}
      />
    </StrictMode>,
  );
  assert.equal(container.querySelectorAll('.cmap-chip').length, 2);
  assert.equal(container.querySelector('a[href="#compare"]')!.textContent, 'Open comparison');
  fireEvent.click(container.querySelector('[aria-label="Remove viridis from comparison"]')!);
  assert.deepEqual(onCompareChange.mock.calls[0][0], ['jet']);
  fireEvent.click(container.querySelector('button.btn')!);
  assert.deepEqual(onCompareChange.mock.calls[1][0], []);
});

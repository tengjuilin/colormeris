// @vitest-environment jsdom
// The whole colormaps page: a link with ?map= starts on Browse with the map
// open, Identify's Show clears what hides the map, the tab shows the comparison
// count, the tray and the drawer set their body classes, and the footer is
// the references the rows number.
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { stubIntersectionObserver } from '../../testing/intersection-observer.ts';
import { resetTooltipForTests } from '../tooltip-element.ts';
import { resetRowObserverForTests } from './browse/use-row-visible.ts';
import { ColormapsApp } from './colormaps-app.tsx';

vi.mock('./identify/index.ts', () => ({
  IdentifyTab: ({
    onShowRow,
    onRecolor,
    compared,
  }: {
    onShowRow: (n: string) => void;
    onRecolor: (f: File, l: null) => void;
    compared: readonly string[];
  }) => (
    <div>
      <button type="button" data-testid="show" onClick={() => onShowRow('viridis')}>
        show
      </button>
      <button type="button" data-testid="recolor" onClick={() => onRecolor(new File(['x'], 'f.png'), null)}>
        recolor
      </button>
      <span data-testid="compared">{compared.join(',')}</span>
    </div>
  ),
}));

let io: ReturnType<typeof stubIntersectionObserver>;
beforeEach(() => {
  io = stubIntersectionObserver();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  resetRowObserverForTests();
  resetTooltipForTests();
  document.body.className = '';
  io.unstub();
  vi.restoreAllMocks();
});

const mount = (url: string) => {
  history.replaceState(null, '', url);
  const container = document.createElement('main');
  container.id = 'cmap-root';
  document.body.append(container);
  return render(
    <StrictMode>
      <ColormapsApp />
    </StrictMode>,
    { container },
  );
};
const tabLabels = (c: HTMLElement) => [...c.querySelectorAll('.cmap-viewtabs a')].map((a) => a.textContent);
const current = (c: HTMLElement) => c.querySelector('.cmap-viewtabs [aria-current]')?.textContent;
const goHash = (hash: string) =>
  act(() => {
    history.replaceState(null, '', `/colormaps.html${location.search}${hash}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

test('a link with ?map= starts on Browse with the map open and built, its folds open', () => {
  const { container } = mount('/colormaps.html?map=viridis');
  assert.equal(current(container), 'Browse');
  const item = container.querySelector<HTMLElement>('.cmap-item[data-name="viridis"]')!;
  assert.ok(item.classList.contains('built') && item.classList.contains('open'));
  assert.equal(item.closest<HTMLDetailsElement>('.cmap-section')!.open, true);
  // narrow screen: the detail is under the row, the drawer is empty and hidden
  assert.equal(item.querySelector('.cmap-detail h2')!.textContent, 'viridis');
  assert.equal(container.querySelector<HTMLElement>('#cmap-drawer')!.hidden, true);
  assert.equal(location.hash, '#browse');
  assert.equal(location.search, '?map=viridis');
});

test('a link with more than ten maps in ?compare= keeps ten, and the tab says so', () => {
  const names = [
    'viridis',
    'jet',
    'gray',
    'hot',
    'cool',
    'spring',
    'summer',
    'autumn',
    'winter',
    'bone',
    'pink',
    'copper',
  ];
  const { container } = mount(`/colormaps.html?compare=${names.join(',')}#browse`);
  assert.equal(tabLabels(container)[1], 'Compare (10)');
  assert.equal(location.search, `?compare=${names.slice(0, 10).join(',')}`);
  assert.equal(container.querySelector<HTMLElement>('.cmap-tray')!.hidden, false);
  assert.ok(document.body.classList.contains('cmap-tray-on'));
  assert.equal(container.querySelectorAll('.cmap-tray .cmap-chip').length, 10);
});

test('the tray and its body class follow the tab and the comparison', () => {
  const { container } = mount('/colormaps.html#browse');
  const tray = container.querySelector<HTMLElement>('.cmap-tray')!;
  assert.equal(tray.hidden, true);
  assert.ok(!document.body.classList.contains('cmap-tray-on'));
  // compare from a row: build it first
  act(() => io.intersect(container.querySelector('.cmap-item[data-name="viridis"]')!));
  container.querySelector<HTMLDetailsElement>('#cmap-sec-sequential')!.open = true;
  fireEvent.click(container.querySelector('.cmap-item[data-name="viridis"] .cmap-cmp')!);
  assert.equal(tabLabels(container)[1], 'Compare (1)');
  assert.equal(tray.hidden, false);
  assert.ok(document.body.classList.contains('cmap-tray-on'));
  assert.equal(location.search, '?compare=viridis');
  goHash('#compare');
  assert.equal(current(container), 'Compare (1)');
  assert.equal(tray.hidden, true);
  assert.ok(!document.body.classList.contains('cmap-tray-on'));
  assert.equal(container.querySelector<HTMLElement>('.cmap-browse')!.hidden, true);
  assert.equal(container.querySelector<HTMLElement>('#cmap-compare')!.hidden, false);
});

test('Identify Show goes to Browse, clears a search that hides the map and opens it', () => {
  const { container } = mount('/colormaps.html#identify');
  assert.equal(current(container), 'Identify');
  // a search on Browse that hides viridis
  goHash('#browse');
  fireEvent.change(container.querySelector('.cmap-search')!, { target: { value: 'jet' } });
  goHash('#identify');
  const item = container.querySelector<HTMLElement>('.cmap-item[data-name="viridis"]')!;
  assert.equal(item.hidden, true);
  const pushed = vi.spyOn(history, 'pushState');
  fireEvent.click(container.querySelector('[data-testid="show"]')!);
  assert.equal(current(container), 'Browse');
  assert.equal(container.querySelector<HTMLInputElement>('.cmap-search')!.value, '');
  assert.equal(item.hidden, false);
  assert.ok(item.classList.contains('open') && item.classList.contains('built'));
  assert.equal(pushed.mock.calls.length, 1, 'one history entry');
  assert.equal(location.search, '?map=viridis');
});

test('Identify Show keeps a search that does not hide the map', () => {
  const { container } = mount('/colormaps.html#browse');
  fireEvent.change(container.querySelector('.cmap-search')!, { target: { value: 'vir' } });
  goHash('#identify');
  fireEvent.click(container.querySelector('[data-testid="show"]')!);
  assert.equal(container.querySelector<HTMLInputElement>('.cmap-search')!.value, 'vir');
});

test('Recolor this goes to the Recolor tab', () => {
  const { container } = mount('/colormaps.html#identify');
  fireEvent.click(container.querySelector('[data-testid="recolor"]')!);
  assert.equal(current(container), 'Recolor');
  assert.equal(container.querySelector<HTMLElement>('.cmap-recolor')!.hidden, false);
});

test('closing the detail from the keyboard returns focus to the row button', () => {
  const { container } = mount('/colormaps.html?map=viridis');
  const btn = container.querySelector<HTMLElement>('.cmap-item[data-name="viridis"] .cmap-open-btn')!;
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  assert.equal(container.querySelector('.cmap-item[data-name="viridis"]')!.classList.contains('open'), false);
  assert.equal(document.activeElement, btn);
  assert.equal(location.search, '');
});

test('wide: the detail goes to the drawer and the body class makes room for it', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const { container } = mount('/colormaps.html?map=viridis');
  const drawer = container.querySelector<HTMLElement>('#cmap-drawer')!;
  assert.equal(drawer.hidden, false);
  assert.equal(drawer.querySelector('h2')!.textContent, 'viridis');
  assert.ok(document.body.classList.contains('cmap-drawer-open'));
  const item = container.querySelector<HTMLElement>('.cmap-item[data-name="viridis"]')!;
  assert.equal(item.querySelector('.cmap-panel')!.hasAttribute('hidden'), true);
  assert.equal(item.querySelector('.cmap-open-btn')!.getAttribute('aria-controls'), 'cmap-drawer');
  goHash('#cvd');
  assert.ok(!document.body.classList.contains('cmap-drawer-open'));
  assert.equal(drawer.hidden, true);
});

test('the strip view is remembered', () => {
  localStorage.removeItem('colormeris.cmapView');
  const { container } = mount('/colormaps.html#browse');
  fireEvent.click(container.querySelector('[data-view-key="gray"]')!);
  assert.ok(container.classList.contains('cmap-single'));
  assert.equal(localStorage.getItem('colormeris.cmapView'), 'gray');
  cleanup();
  const again = mount('/colormaps.html#browse');
  assert.ok(again.container.classList.contains('cmap-single'));
  assert.equal(again.container.querySelector('[data-view-key="gray"]')!.getAttribute('aria-pressed'), 'true');
  localStorage.removeItem('colormeris.cmapView');
});

test('the footer lists the references in the numbering order and links open it', () => {
  const { container } = mount('/colormaps.html#browse');
  const footer = container.querySelector<HTMLDetailsElement>('#cmap-about')!;
  assert.equal(footer.open, false);
  const refs = footer.querySelectorAll('ol')[0].children.length;
  assert.equal(footer.querySelectorAll('ol')[1].getAttribute('start'), String(refs + 1));
  assert.ok(footer.querySelector('#ref-ciede2000'));
  fireEvent.click(container.querySelector('#cmap-pop-method a[href="#cmap-about"]')!);
  assert.equal(footer.open, true);
});

// @vitest-environment jsdom
// The shared wrappers: Strip, RatingPills / RatingCells, SvgFigure, the tooltip and the figure input.
import assert from 'node:assert/strict';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cmapData } from '../../../core/colormap-library.ts';
import { base } from '../../library-cache.ts';
import { FigureCanvas, FigureInput, useFigureInput } from './figure-input.tsx';
import { RatingCells, RatingPills } from './rating.tsx';
import { Strip } from './strip.tsx';
import { SvgFigure } from './svg-figure.tsx';
import { TooltipProvider, useTooltip } from './tooltip.tsx';

// jsdom has no 2D context (and logs when asked for one); the components guard for null.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const viridis = cmapData.maps.find((m) => m.name === 'viridis')!;

test('Strip is a 1-pixel-high canvas, one pixel per color, with a qualitative variant', () => {
  const colors = base(viridis);
  const { container, rerender } = render(<Strip colors={colors} />);
  const c = container.querySelector('canvas')!;
  assert.equal(c.className, 'cmap-paint');
  assert.equal(c.width, colors.length);
  assert.equal(c.height, 1);
  assert.equal(c.getAttribute('aria-hidden'), 'true');
  rerender(<Strip colors={colors.slice(0, 8)} qualitative />);
  assert.equal(container.querySelector('canvas')!.className, 'cmap-paint qual');
  assert.equal(container.querySelector('canvas')!.width, 8);
});

test('RatingPills and RatingCells keep the markup of the list', () => {
  const { container } = render(
    <>
      <RatingPills map={viridis} />
      <RatingCells map={viridis} />
    </>,
  );
  const pills = container.querySelectorAll('.cmap-badges > .cmap-pill');
  assert.equal(pills.length, 4);
  assert.match(pills[0].getAttribute('title')!, /^Uniform: (yes|partly|no)\./);
  assert.equal(pills[0].querySelector('.cmap-glyph')!.getAttribute('aria-hidden'), 'true');
  assert.match(pills[0].querySelector('.sr-only')!.textContent!, /^: (yes|partly|no)$/);
  assert.equal(container.querySelectorAll('.cmap-rc').length, 4);
  assert.match(container.querySelector('.cmap-rc .sr-only')!.textContent!, /^Uniform: /);
});

test('RatingCells shows a dash for ratings that do not apply', () => {
  const qual = cmapData.maps.find((m) => m.kind === 'qualitative')!;
  const { container } = render(<RatingCells map={qual} />);
  const na = container.querySelector('.cmap-rc.na');
  if (na) assert.equal(na.textContent, '—');
});

test('SvgFigure runs the builder once and replaces the children when it changes', () => {
  let built = 0;
  const make = (id: string) => () => {
    built++;
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.id = id;
    return s;
  };
  const a = make('a');
  const { container, rerender } = render(<SvgFigure build={a} />);
  assert.equal(container.querySelectorAll('svg').length, 1);
  rerender(<SvgFigure build={a} />);
  assert.equal(built, 1);
  rerender(<SvgFigure build={make('b')} />);
  assert.equal(container.querySelectorAll('svg').length, 1);
  assert.equal(container.querySelector('svg')!.id, 'b');
});

let api!: ReturnType<typeof useTooltip>;
function Probe() {
  api = useTooltip();
  return null;
}

test('the tooltip is one body element updated by hand', () => {
  render(
    <TooltipProvider>
      <Probe />
    </TooltipProvider>,
  );
  const tip = document.body.querySelector<HTMLElement>('.cmap-tip')!;
  assert.equal(tip.hidden, true);
  act(() => api.showTip({ hex: '#112233', title: 'viridis · Colormap', text: ['#112233', 'rgb(17, 34, 51)'] }, 10, 10));
  assert.equal(tip.hidden, false);
  assert.equal(tip.querySelector('.cmap-tip-title')!.textContent, 'viridis · Colormap');
  assert.equal(tip.querySelector('.cmap-tip-lines .cmap-tip-hex')!.textContent, '#112233');
  assert.equal(tip.querySelectorAll('.cmap-tip-lines > div').length, 2);
  act(() => api.flashCopied());
  assert.equal(tip.querySelector<HTMLElement>('.cmap-tip-copied')!.hidden, false);
  act(() => api.hideTip());
  assert.equal(tip.hidden, true);
});

test('there is one tip for the page; the provider hides it when the tab changes', () => {
  const { rerender } = render(
    <TooltipProvider tab="a">
      <Probe />
    </TooltipProvider>,
  );
  act(() => api.showTip({ hex: '#000000', title: 't', text: ['x'] }, 5, 5));
  const marker = document.createElement('div');
  act(() => api.showTip({ hex: '#000000', title: 't', text: ['x'] }, 5, 5, marker));
  assert.equal(marker.hidden, false);
  assert.equal(document.body.querySelectorAll('.cmap-tip').length, 1);
  rerender(
    <TooltipProvider tab="b">
      <Probe />
    </TooltipProvider>,
  );
  assert.equal(document.body.querySelector<HTMLElement>('.cmap-tip')!.hidden, true);
  assert.equal(marker.hidden, true);
});

test('useTooltip outside a provider does nothing', () => {
  render(<Probe />);
  api.showTip({ hex: '#000000', title: 't', text: [] }, 0, 0);
  api.hideTip();
});

function Host() {
  const { fig } = useFigureInput(
    { tab: 'cvd', getTab: () => 'cvd', label: 'Your figure', hints: { empty: 'Drop here', loaded: '' } },
    {},
  );
  return (
    <div id="host">
      <FigureInput fig={fig} buttons={<button type="button">Extra</button>} />
      <section id="where">
        <FigureCanvas fig={fig} />
      </section>
    </div>
  );
}
test('FigureInput puts the drop zone, file input and bar buttons into the page; the canvas goes where asked', () => {
  const { container, unmount } = render(<Host />);
  assert.ok(container.querySelector('.cmap-drop-wrap .cmap-drop'));
  assert.equal(container.querySelector('.cmap-drop-wrap .cmap-id-hint')!.textContent, 'Drop here');
  assert.equal(container.querySelector<HTMLInputElement>('input[type=file]')!.accept, 'image/*');
  const bar = container.querySelector('.cmap-id-bar')!;
  const labels = [...bar.querySelectorAll('button')].map((b) => b.textContent);
  assert.deepEqual(labels, ['Example image (jet)', 'Extra', 'Clear']);
  const canvas = container.querySelector('#where canvas')!;
  assert.equal(canvas.getAttribute('aria-label'), 'Your figure');
  assert.equal((canvas as HTMLElement).hidden, true);
  unmount();
});

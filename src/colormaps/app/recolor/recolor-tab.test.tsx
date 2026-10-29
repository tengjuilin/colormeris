// @vitest-environment jsdom
// The Recolor tab: structure and controls (React), and the engine on a
// synthetic figure with a stand-in for the figure input.
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { createRecolorEngine } from './recolor-engine.ts';
import { EMPTY_READOUT, type OldNote } from './recolor-model.ts';
import { RecolorTab } from './recolor-tab.tsx';
import { createValueStore } from './value-store.ts';

const ctx2d = { putImageData: vi.fn(), drawImage: vi.fn() };
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const mount = () =>
  render(
    <StrictMode>
      <RecolorTab getTab={() => 'recolor'} incoming={null} />
    </StrictMode>,
  );

test('structure: heading, drop zone, hidden controls and panels', () => {
  const { container } = mount();
  assert.equal(container.querySelector('h2#cmap-recolor-title')!.textContent, 'Recolor a figure into another colormap');
  assert.ok(container.querySelector('.cmap-drop'));
  assert.equal(container.querySelector<HTMLElement>('.cmap-rc-controls')!.hidden, true);
  assert.equal(container.querySelector<HTMLElement>('.cmap-rc-strips')!.hidden, true);
  assert.equal(container.querySelector<HTMLElement>('.cmap-rc-old')!.hidden, true);
  assert.deepEqual(
    [...container.querySelectorAll<HTMLElement>('.cmap-rc-panel')].map((p) => p.hidden),
    [true, true],
  );
  assert.deepEqual(
    [...container.querySelectorAll('.cmap-id-bar button')].map((b) => b.textContent),
    ['Example image (jet)', 'Download PNG', 'Clear'],
  );
  assert.equal(container.querySelectorAll('.cmap-rc-field').length, 5);
  assert.equal(container.querySelectorAll('.cmap-rc-strip[role="slider"]').length, 2);
});

test('controls: sliders update their outputs, Draw regions toggles, Reversed checks', () => {
  const { container } = mount();
  const outs = () => [...container.querySelectorAll('.cmap-rc-input output')].map((o) => o.textContent);
  assert.deepEqual(outs(), ['12', '2%', 'Whole image']);
  const ranges = container.querySelectorAll<HTMLInputElement>('input[type=range]');
  fireEvent.change(ranges[0], { target: { value: '20' } });
  fireEvent.change(ranges[1], { target: { value: '5' } });
  assert.deepEqual(outs(), ['20', '5%', 'Whole image']);
  const draw = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Draw regions')!;
  assert.equal(draw.getAttribute('aria-pressed'), 'false');
  fireEvent.click(draw);
  assert.equal(draw.getAttribute('aria-pressed'), 'true');
  assert.equal(draw.className, 'btn small active');
  assert.match(container.querySelector('.cmap-drop-wrap > .cmap-id-hint')!.textContent!, /^Drag rectangles/);
  fireEvent.keyDown(document, { key: 'Escape' });
  assert.equal(draw.getAttribute('aria-pressed'), 'false');
  const rev = [...container.querySelectorAll<HTMLInputElement>('.cmap-rc-check input')][0];
  fireEvent.click(rev);
  assert.equal(rev.checked, true);
  assert.equal(
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Whole image')!.hasAttribute('disabled'),
    true,
  );
});

test('the strips are sliders; arrow keys without a figure do nothing and do not throw', () => {
  const { container } = mount();
  const strip = container.querySelector<HTMLElement>('.cmap-rc-strip')!;
  fireEvent.keyDown(strip, { key: 'ArrowRight' });
  assert.equal(strip.getAttribute('aria-valuenow'), null);
  assert.equal(container.querySelector<HTMLElement>('.cmap-rc-mark')!.hidden, true);
});

// ---- the engine on a synthetic figure: a gray ramp with a bar on the right ----

function figure() {
  const w = 60;
  const h = 40;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (x >= 40 && x < 50 && y >= 5 && y < 35) {
        const v = Math.round(255 * ((y - 5) / 29)); // dark at the top
        data.set([v, v, v, 255], (y * w + x) * 4);
      } else if (x < 30 && y >= 5 && y < 35) {
        const v = Math.round(255 * (x / 29));
        data.set([v, v, v, 255], (y * w + x) * 4);
      }
    }
  return { width: w, height: h, data };
}

test('calibrating along the bar indexes the pixels, recolors them and reports the readout', async () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  );
  const get = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
  get.mockReturnValue(ctx2d as unknown as CanvasRenderingContext2D);
  const img = figure();
  const fig = {
    img,
    line: null,
    boxes: [],
    dragging: false,
    name: 'fig',
    redraw() {},
    canvas: document.createElement('canvas'),
  };
  const out = document.createElement('canvas');
  const readout = createValueStore(EMPTY_READOUT);
  const seen: { status: string[]; ready: boolean[]; note: (OldNote | null)[]; out: boolean[]; colors: number } = {
    status: [],
    ready: [],
    note: [],
    out: [],
    colors: 0,
  };
  const engine = createRecolorEngine({
    // biome-ignore lint/suspicious/noExplicitAny: a stand-in for the figure input
    fig: () => fig as any,
    out: () => out,
    overlays: () => [document.createElement('canvas'), document.createElement('canvas')],
    settings: () => ({ chosen: 'magma', reversed: false, tolerance: 12, band: 0.02, flash: true, drawing: false }),
    ui: {
      setStatus: (s) => seen.status.push(s),
      setNote: (n) => seen.note.push(n),
      setReady: (b) => seen.ready.push(b),
      setOutShown: (b) => seen.out.push(b),
      setStripColors: (c) => {
        seen.colors = c?.neu.length ?? 0;
      },
      setRegionCount: () => {},
      readout,
    },
  });
  engine.calibrate({ x: 45, y: 6 }, { x: 45, y: 33 });
  await vi.runAllTimersAsync();
  assert.deepEqual(seen.ready, [true]);
  assert.equal(seen.out.at(-1), true);
  assert.equal(seen.colors, 128);
  assert.equal(seen.note.length, 1);
  assert.equal(out.width, 60);
  assert.match(readout.get().text, /of the pixels have a color of the bar and are recolored/);
  assert.equal(seen.status.at(-1), '');
  // Hovering a position highlights, then clearing hides the mark but keeps the text.
  engine.highlight(0.5, true);
  assert.equal(readout.get().t, 0.5);
  assert.equal(readout.get().now, 50);
  assert.match(readout.get().text, /At 50% of the bar/);
  engine.clearHighlight();
  assert.equal(readout.get().t, null);
  assert.match(readout.get().text, /At 50%/);
  // A reset forgets the figure's state.
  engine.reset();
  assert.deepEqual(readout.get(), EMPTY_READOUT);
  assert.equal(seen.ready.at(-1), false);
  assert.equal(engine.hasIndex(), false);
  vi.unstubAllGlobals();
});

// ---- a figure handed over from Identify: its line belongs to that file only ----

let decodes = 0;
function stubImages() {
  decodes = 0;
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  );
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 20;
      naturalHeight = 20;
      onload: (() => void) | null = null;
      set src(_: string) {
        // The first image decodes fast, the next one slowly: a handed-over file can arrive after another load started.
        setTimeout(() => this.onload?.(), decodes++ === 0 ? 1 : 10);
      }
    },
  );
  URL.createObjectURL = () => 'blob:x';
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect() {},
    drawImage() {},
    putImageData() {},
    setLineDash() {},
    strokeRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    arc() {},
    fill() {},
    fillRect2() {},
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4).fill(200),
    }),
  } as unknown as CanvasRenderingContext2D);
}
const png = (n: string) => new File(['x'], n, { type: 'image/png' });
const line = { start: { x: 2, y: 2 }, end: { x: 2, y: 15 } };

test('the handed-over line calibrates only the file it came with', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  stubImages();
  const props = (incoming: { id: number; file: File; line: typeof line | null } | null) => (
    <RecolorTab getTab={() => 'recolor'} incoming={incoming} />
  );
  const a = png('a.png');
  const { container, rerender } = render(props(null));
  const status = () => container.querySelector('.cmap-id-status')!.textContent;
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
  // The user drops B; then A is handed over while B still decodes. B's load must not use A's line.
  Object.defineProperty(input, 'files', { value: [png('b.png')], configurable: true });
  fireEvent.change(input);
  rerender(props({ id: 1, file: a, line }));
  await act(() => vi.advanceTimersByTimeAsync(5)); // B is loaded
  assert.equal(status(), '');
  await act(() => vi.advanceTimersByTimeAsync(10)); // A is loaded, with its line
  assert.match(status(), /^Reading the colors/);
});

test('stopping and starting the engine resumes a half-done indexing run', async () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2d as unknown as CanvasRenderingContext2D);
  const img = figure();
  const fig = {
    img,
    line: null,
    boxes: [],
    dragging: false,
    name: 'fig',
    redraw() {},
    canvas: document.createElement('canvas'),
  };
  const readout = createValueStore(EMPTY_READOUT);
  const status: string[] = [];
  const ready: boolean[] = [];
  const engine = createRecolorEngine({
    // biome-ignore lint/suspicious/noExplicitAny: a stand-in for the figure input
    fig: () => fig as any,
    out: () => document.createElement('canvas'),
    overlays: () => [null, null],
    settings: () => ({ chosen: 'magma', reversed: false, tolerance: 12, band: 0.02, flash: true, drawing: false }),
    ui: {
      setStatus: (s) => status.push(s),
      setNote: () => {},
      setReady: (b) => ready.push(b),
      setOutShown: () => {},
      setStripColors: () => {},
      setRegionCount: () => {},
      readout,
    },
  });
  engine.calibrate({ x: 45, y: 6 }, { x: 45, y: 33 });
  engine.stop(); // before the first frame: the run is dropped
  await vi.runAllTimersAsync();
  assert.deepEqual(ready, []);
  engine.start(); // the remount picks it up again
  await vi.runAllTimersAsync();
  assert.deepEqual(ready, [true]);
  assert.equal(engine.hasIndex(), true);
  vi.unstubAllGlobals();
});

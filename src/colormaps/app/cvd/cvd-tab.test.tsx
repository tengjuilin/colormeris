// @vitest-environment jsdom
// The CVD tab's controls and structure. Images do not load in jsdom, so the
// simulation itself is tested in cvd-model.test.ts.
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CvdTab } from './cvd-tab.tsx';

// jsdom has no 2D context (and logs when asked for one); the components guard for null.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Without an image the example is fetched when the tab is shown; fail it quietly.
const stubFetch = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 404 })),
  );

test('structure: heading, figure input, hidden controls and five panels', () => {
  const { container } = render(<CvdTab active={false} getTab={() => 'cvd'} />);
  assert.equal(container.querySelector('h2#cmap-cvd-title')!.textContent, 'Simulate color vision deficiency');
  assert.ok(container.querySelector('.cmap-drop'));
  assert.equal(container.querySelector<HTMLElement>('.cmap-rc-controls')!.hidden, true);
  assert.equal(container.querySelector<HTMLElement>('.cmap-cvd-grid')!.hidden, true);
  assert.equal(container.querySelectorAll('.cmap-cvd-panel').length, 5);
  assert.deepEqual(
    [...container.querySelectorAll('.cmap-cvd-panel figcaption')].map((c) => c.textContent),
    [
      'Original',
      'Protanopia (Machado 2009)',
      'Deuteranopia (Machado 2009)',
      'Tritanopia (Brettel 1997)',
      'Achromatopsia (grayscale by luminance)',
    ],
  );
  const hidden = [...container.querySelectorAll<HTMLElement>('.cmap-cvd-panel')].map((p) => p.hidden);
  assert.deepEqual(hidden, [false, true, false, true, true]); // only deuteranopia by default
  assert.equal(container.querySelectorAll('canvas[aria-label$="simulation"]').length, 4);
  assert.deepEqual(
    [...container.querySelectorAll('.cmap-id-bar button')].map((b) => b.textContent),
    ['Example image (jet)', 'Download PNG', 'Clear'],
  );
  assert.equal(container.querySelectorAll('a[href^="#ref-"]').length, 4);
});

test('the kind buttons set aria-pressed, All shows all panels, Gray disables the model', () => {
  const { container } = render(<CvdTab active={false} getTab={() => 'cvd'} />);
  const pressed = () =>
    [...container.querySelectorAll('.cmap-tabs button')]
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map((b) => b.textContent);
  assert.deepEqual(pressed(), ['Deutan']);
  fireEvent.click(screen.getByRole('button', { name: 'All', hidden: true }));
  assert.deepEqual(pressed(), ['All']);
  assert.equal(container.querySelector('.cmap-cvd-grid')!.className, 'cmap-cvd-grid all');
  assert.equal([...container.querySelectorAll<HTMLElement>('.cmap-cvd-panel')].filter((p) => p.hidden).length, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Gray (achromatopsia)', hidden: true }));
  assert.equal(container.querySelector('select')!.disabled, true);
  assert.equal(container.querySelector('.cmap-cvd-grid')!.className, 'cmap-cvd-grid');
});

test('severity and model update the output and the captions', () => {
  const { container } = render(<CvdTab active={false} getTab={() => 'cvd'} />);
  const range = container.querySelector<HTMLInputElement>('input[type=range]')!;
  fireEvent.change(range, { target: { value: '0.5' } });
  assert.equal(container.querySelector('output')!.textContent, '0.5');
  fireEvent.change(container.querySelector('select')!, { target: { value: 'brettel' } });
  const caps = [...container.querySelectorAll('.cmap-cvd-panel figcaption')].map((c) => c.textContent);
  // The caption follows after the frame in which the slider settled; the model applies at once.
  assert.match(caps[2], /^Deuteranomaly|^Deuteranopia/);
  assert.match(caps[2], /Brettel 1997/);
});

test('showing the tab loads the example once', async () => {
  stubFetch();
  const { rerender } = render(<CvdTab active={false} getTab={() => 'cvd'} />);
  expect(fetch).not.toHaveBeenCalled();
  rerender(<CvdTab active getTab={() => 'cvd'} />);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  assert.equal((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0], 'examples/example-jet.png');
  rerender(<CvdTab active={false} getTab={() => 'cvd'} />);
  rerender(<CvdTab active getTab={() => 'cvd'} />);
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});

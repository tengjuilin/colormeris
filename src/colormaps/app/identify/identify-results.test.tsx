// @vitest-environment jsdom
// The verdict, the ranked list and the Compare / Show / Recolor buttons of the Identify tab.
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { describeMatches } from './identify-model.ts';
import { IdentifyResults, type Outcome } from './identify-results.tsx';

// jsdom has no 2D context (and logs when asked for one); the components guard for null.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const outcome = (mode: 'bar' | 'whole', results: Outcome['results']): Outcome => ({
  mode,
  results,
  file: new File(['x'], 'fig.png', { type: 'image/png' }),
  line: { start: { x: 1, y: 2 }, end: { x: 3, y: 4 } },
});

function setup(o: Outcome | null, compared: string[] = []) {
  const on = { onShow: vi.fn(), onCompare: vi.fn(), onRecolor: vi.fn() };
  const ui = (
    <IdentifyResults
      outcome={o}
      desc={o ? describeMatches(o.results) : null}
      pending={false}
      compared={compared}
      {...on}
    />
  );
  return { ...render(ui), on };
}

test('an exact colorbar match: verdict, list, tie grouping and the buttons', () => {
  const o = outcome('bar', [
    { name: 'viridis', score: 0.4, reversed: false },
    { name: 'viridis_alias', score: 0.405, reversed: false },
    { name: 'plasma', score: 9, reversed: true },
  ]);
  const { container, on } = setup(o);
  const verdict = container.querySelector('.cmap-id-verdict')!;
  assert.match(verdict.textContent!, /^Best match: viridis \(ΔE 0\.4\)\. Recolor this figure$/);
  assert.equal(verdict.querySelector('strong')!.textContent, 'viridis');
  const items = container.querySelectorAll('.cmap-id-list > .cmap-id-item');
  assert.equal(items.length, 2);
  assert.match(items[0].querySelector('.cmap-id-name')!.textContent!, /viridis \(same colors: viridis_alias\)/);
  assert.equal(items[0].querySelector('.cmap-mini canvas.cmap-paint') != null, true);
  assert.equal(items[1].querySelector('.cmap-id-name')!.textContent, 'plasma (reversed)');
  assert.match(items[1].querySelector('button')!.title, /matches reversed/);
  assert.equal(container.querySelector<HTMLElement>('.cmap-fig-cap')!.hidden, false);

  fireEvent.click(screen.getByRole('button', { name: 'Show viridis in Browse' }));
  expect(on.onShow).toHaveBeenCalledWith('viridis');
  fireEvent.click(screen.getByRole('button', { name: 'Compare viridis' }));
  expect(on.onCompare).toHaveBeenCalledWith('viridis');
  fireEvent.click(screen.getByRole('button', { name: 'Recolor this figure' }));
  expect(on.onRecolor).toHaveBeenCalledWith(o.file, o.line);
});

test('Compare is "In comparison" and disabled for a map already compared, or when 10 are', () => {
  const o = outcome('bar', [{ name: 'viridis', score: 0.4 }]);
  const { rerender } = setup(o, ['viridis']);
  const b = screen.getByRole('button', { name: 'Compare viridis' }) as HTMLButtonElement;
  assert.equal(b.textContent, 'In comparison');
  assert.equal(b.disabled, true);
  const ten = Array.from({ length: 10 }, (_, i) => `m${i}`);
  rerender(
    <IdentifyResults
      outcome={o}
      desc={describeMatches(o.results)}
      pending={false}
      compared={ten}
      onShow={() => {}}
      onCompare={() => {}}
      onRecolor={() => {}}
    />,
  );
  const b2 = screen.getByRole('button', { name: 'Compare viridis' }) as HTMLButtonElement;
  assert.equal(b2.textContent, 'Compare');
  assert.equal(b2.disabled, true);
});

test('close, none and whole-image verdicts', () => {
  const { container, rerender } = setup(outcome('bar', [{ name: 'x', score: 4 }]));
  assert.match(
    container.querySelector('.cmap-id-verdict')!.textContent!,
    /^Closest: x \(ΔE 4\.0\)\. Not an exact match/,
  );
  const again = (o: Outcome) =>
    rerender(
      <IdentifyResults
        outcome={o}
        desc={describeMatches(o.results)}
        pending={false}
        compared={[]}
        onShow={() => {}}
        onCompare={() => {}}
        onRecolor={() => {}}
      />,
    );
  again(outcome('whole', [{ name: 'x', score: 9, coverage: 0.5 }]));
  const text = container.querySelector('.cmap-id-verdict')!.textContent!;
  assert.match(text, /^No good match among the known colormaps \(best ΔE 9\.0\)\. Whole image:/);
  assert.equal(container.querySelector('.cmap-id-verdict button'), null);
  assert.match(container.querySelector('.cmap-id-score')!.textContent!, /^ΔE 9\.0, covers 50%$/);
});

test('no colors found says so, hides the note and keeps Recolor for a colorbar run', () => {
  const { container } = setup(outcome('bar', []));
  assert.match(
    container.querySelector('.cmap-id-verdict')!.textContent!,
    /^Could not find any colors to match\. Recolor/,
  );
  assert.equal(container.querySelector<HTMLElement>('.cmap-fig-cap')!.hidden, true);
  assert.equal(container.querySelectorAll('.cmap-id-item').length, 0);
});

test('while matching the verdict and list are empty and the list is busy', () => {
  const { container } = render(
    <IdentifyResults
      outcome={null}
      desc={null}
      pending
      compared={[]}
      onShow={() => {}}
      onCompare={() => {}}
      onRecolor={() => {}}
    />,
  );
  assert.equal(container.querySelector('.cmap-id-verdict')!.textContent, '');
  assert.equal(container.querySelector('.cmap-id-list')!.getAttribute('aria-busy'), 'true');
});

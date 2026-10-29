// @vitest-environment jsdom
// The Colorbar card against a minimal workspace around createProject(): the real tick focus, the real
// commit-style history, notify() from the store as the bridge. Canvas drawing and the reference match need an
// image and are covered in the browser; the match is tested through its cache.
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type { Panel, Workspace, WorkspaceContext } from '../../../types/index.ts';
import { createProject } from '../../project/project.ts';
import { WsContext } from '../../react/use-workspace.ts';
import { notify } from '../store.ts';
import { BarMatch } from './bar-match.tsx';
import { ColorbarCard } from './colorbar-card.tsx';
import { setupWorkspaceTickFocus } from './tick-focus.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  // jsdom has no canvas; the strip's drawing is checked in the browser.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function setup() {
  const log: string[] = [];
  const project = createProject('heatmap');
  project.activePanelId = project.panels[0].id;
  const app = { project, sourceCanvas: {}, mode: null as { type: string } | null, imageData: null, pages: new Map() };
  let seq = 0;
  const w = {
    app,
    activePanel: () => project.panels[0],
    resultFor: () => ({ error: 'none' }),
    newTickId: () => `t${seq++}`,
    setMode: (m: string | null) => {
      app.mode = m ? { type: m } : null;
      log.push(`mode:${m}`);
      notify({ light: true });
    },
    pushHistory: () => log.push('history'),
    changed: (o?: { light?: boolean }) => {
      log.push(o?.light ? 'light' : 'full');
      notify({ light: o?.light });
    },
    commit: (fn: (p: Panel) => unknown) => {
      w.pushHistory();
      fn(project.panels[0]);
      w.changed();
    },
  } as unknown as WorkspaceContext;
  Object.assign(w, setupWorkspaceTickFocus(w));
  const ws = { activePanel: w.activePanel, pushHistory: w.pushHistory, changed: w.changed } as unknown as Workspace;
  render(
    <StrictMode>
      <WsContext.Provider value={{ ws, w }}>
        <ColorbarCard />
      </WsContext.Provider>
    </StrictMode>,
  );
  const cb = project.panels[0].colorbar;
  return { log, project, app, cb, w };
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const rows = () => [...document.querySelectorAll<HTMLTableRowElement>('#tick-list tr')];
const valueInput = (i: number) => rows()[i].querySelector('input') as HTMLInputElement;
const posInput = (i: number) => rows()[i].querySelector('.pos input') as HTMLInputElement;
const place = (cb: { start: unknown; end: unknown }) => {
  cb.start = { x: 0, y: 0 };
  cb.end = { x: 100, y: 0 };
  notify();
};

test('empty: badge, disabled buttons, hidden strip, hidden table, no match line', () => {
  const { cb } = setup();
  assert.equal(el('bar-state').textContent, 'not placed');
  assert.equal(el('bar-state').className, 'badge todo');
  assert.equal(el<HTMLButtonElement>('tick-add').disabled, true);
  assert.equal(el<HTMLButtonElement>('tick-type').disabled, true);
  assert.equal(el<HTMLCanvasElement>('bar-strip').hidden, true);
  assert.equal(el('bar-match').hidden, true);
  assert.equal(document.querySelector<HTMLElement>('table.ticks')!.hidden, true);
  assert.equal(el('bar-cmap').hidden, true);
  assert.equal(el<HTMLSelectElement>('bar-source').value, 'figure');
  assert.equal(el<HTMLSelectElement>('bar-scale').value, cb.scale);
});

test('Place colorbar ends toggles the mode, shows pressed, and keeps the id for the B hotkey', () => {
  const { log, app } = setup();
  const btn = el<HTMLButtonElement>('bar-place');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  // What hotkeys.ts does. setMode notifies light, which React renders in a microtask.
  act(() => btn.click());
  assert.deepEqual(log, ['mode:colorbar']);
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.equal(btn.classList.contains('active'), true);
  act(() => btn.click());
  assert.equal(app.mode, null);
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
});

test('placing again asks before dropping page ticks and keeps typed ones', () => {
  const { cb, log } = setup();
  cb.ticks = [
    { id: 'a', x: 1, y: 1, value: 1 },
    { id: 'b', t: 0.5, value: 2 },
  ];
  notify();
  const ask = vi.fn(() => false);
  vi.stubGlobal('confirm', ask);
  el('bar-place').click();
  assert.equal(ask.mock.calls.length, 1);
  assert.equal(cb.ticks.length, 2);
  assert.deepEqual(log, []);
  ask.mockReturnValue(true);
  el('bar-place').click();
  assert.deepEqual(
    cb.ticks.map((k) => k.id),
    ['b'],
  );
  assert.deepEqual(log, ['history', 'full', 'mode:colorbar']);
});

test('Add ticks needs a placed bar, then toggles tick mode with pressed state', () => {
  const { cb, log } = setup();
  const add = el<HTMLButtonElement>('tick-add');
  assert.equal(add.disabled, true);
  place(cb);
  assert.equal(add.disabled, false);
  assert.equal(el<HTMLButtonElement>('tick-type').disabled, false);
  fireEvent.click(add);
  assert.equal(add.getAttribute('aria-pressed'), 'true');
  fireEvent.click(add);
  assert.deepEqual(log, ['mode:tick', 'mode:null']);
  assert.equal(add.getAttribute('aria-pressed'), 'false');
});

test('Type a tick: first free of 0, 1, 0.5 on the bar, one history entry, value field focused', () => {
  const { cb, log } = setup();
  place(cb);
  fireEvent.click(el('tick-type'));
  assert.deepEqual(log, ['history', 'full']);
  assert.equal(cb.ticks.length, 1);
  assert.equal(cb.ticks[0].x, 0);
  assert.equal(document.activeElement, valueInput(0));
  assert.equal(rows()[0].className, 'invalid');
  assert.equal(posInput(0).value, '0');
  fireEvent.click(el('tick-type'));
  fireEvent.click(el('tick-type'));
  assert.deepEqual(
    cb.ticks.map((k) => k.x),
    [0, 100, 50],
  );
  assert.equal(document.activeElement, valueInput(2));
  assert.equal(document.querySelector<HTMLElement>('table.ticks')!.hidden, false);
});

test('the tick value: no history on focus, one at the first edit, light while typing, Enter blurs', () => {
  const { cb, log } = setup();
  place(cb);
  cb.ticks = [{ id: 'k', x: 0, y: 0, value: 3 }];
  notify();
  const input = valueInput(0);
  assert.equal(input.value, '3');
  fireEvent.focus(input);
  assert.deepEqual(log, []);
  fireEvent.input(input, { target: { value: '12.5' } });
  fireEvent.input(input, { target: { value: '' } });
  assert.deepEqual(log, ['history', 'light', 'light']);
  assert.ok(Number.isNaN(cb.ticks[0].value));
  assert.equal(rows()[0].className, 'invalid');
  assert.equal(input.value, '');
  fireEvent.input(input, { target: { value: '7' } });
  assert.equal(cb.ticks[0].value, 7);
  assert.equal(rows()[0].className, '');
  const blur = vi.spyOn(input, 'blur');
  fireEvent.keyDown(input, { key: 'Enter' });
  assert.equal(blur.mock.calls.length, 1);
});

test('the position in % moves a page tick along the bar, clamps to -10..110 and keeps typed ticks as t', () => {
  const { cb, log } = setup();
  place(cb);
  cb.ticks = [
    { id: 'p', x: 0, y: 0, value: 1 },
    { id: 'q', t: 0.2, value: 2 },
  ];
  notify();
  assert.equal(posInput(1).value, '20');
  fireEvent.focus(posInput(0));
  fireEvent.input(posInput(0), { target: { value: '25' } });
  fireEvent.change(posInput(0), { target: { value: '25' } });
  assert.equal(cb.ticks[0].x, 25);
  assert.deepEqual(log, ['history', 'full']);
  fireEvent.change(posInput(1), { target: { value: '300' } });
  assert.equal(cb.ticks[1].t, 1.1);
  assert.equal(posInput(1).value, '110');
  // Garbage changes nothing but still renders.
  log.length = 0;
  fireEvent.change(posInput(1), { target: { value: '' } });
  assert.deepEqual(log, ['full']);
  assert.equal(cb.ticks[1].t, 1.1);
});

test('the remove button drops that tick with one history entry', () => {
  const { cb, log } = setup();
  place(cb);
  cb.ticks = [
    { id: 'a', x: 0, y: 0, value: 1 },
    { id: 'b', x: 50, y: 0, value: 2 },
  ];
  notify();
  fireEvent.click(rows()[0].querySelector('button')!);
  assert.deepEqual(
    cb.ticks.map((k) => k.id),
    ['b'],
  );
  assert.deepEqual(log, ['history', 'full']);
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].dataset.id, 'b');
});

test('rows are keyed by tick id: the row element survives adding a tick before it', () => {
  const { cb } = setup();
  place(cb);
  cb.ticks = [{ id: 'b', x: 50, y: 0, value: 2 }];
  notify();
  const before = rows()[0];
  cb.ticks.unshift({ id: 'a', x: 0, y: 0, value: 1 });
  notify();
  assert.equal(rows()[1], before);
});

test('known colormap: the source select adds 0 and 1 ends, focuses the first value, shows the picker', () => {
  const { cb, log } = setup();
  fireEvent.change(el('bar-source'), { target: { value: 'colormap' } });
  assert.deepEqual(log, ['history', 'full']);
  assert.equal(cb.colormap?.name, 'viridis');
  assert.deepEqual(
    cb.ticks.map((k) => [k.t, k.value]),
    [
      [0, 0],
      [1, 1],
    ],
  );
  assert.equal(document.activeElement, valueInput(0));
  assert.equal(el('bar-cmap').hidden, false);
  assert.equal(screen.getByRole<HTMLInputElement>('combobox', { name: 'Colormap' }).value, 'viridis');
  assert.equal(el('bar-state').textContent, 'viridis · 2 ticks');
  assert.equal(el('bar-state').className, 'badge ok');
  // The strip shows the known colors before any result.
  assert.equal(el<HTMLCanvasElement>('bar-strip').hidden, false);
});

test('known colormap on a log scale gets 1 and 10; existing ticks are kept', () => {
  const { cb } = setup();
  cb.scale = 'log10';
  notify();
  fireEvent.change(el('bar-source'), { target: { value: 'colormap' } });
  assert.deepEqual(
    cb.ticks.map((k) => k.value),
    [1, 10],
  );
  // Picking another map keeps the ticks and does not steal the focus.
  const input = screen.getByRole<HTMLInputElement>('combobox', { name: 'Colormap' });
  const ids = cb.ticks.map((k) => k.id);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'inferno' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  assert.equal(cb.colormap?.name, 'inferno');
  assert.deepEqual(
    cb.ticks.map((k) => k.id),
    ids,
  );
});

test('picking a map by typing name_r reverses it; the Reversed box flips it', () => {
  const { cb, log } = setup();
  cb.colormap = { name: 'viridis', reversed: false };
  cb.ticks = [{ id: 'a', t: 0, value: 0 }];
  notify();
  const input = screen.getByRole<HTMLInputElement>('combobox', { name: 'Colormap' });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'inferno_r' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  assert.deepEqual(cb.colormap, { name: 'inferno', reversed: true });
  assert.equal(el<HTMLInputElement>('bar-cmap-rev').checked, true);
  assert.equal(el('bar-state').textContent, 'inferno_r · 1 tick');
  log.length = 0;
  fireEvent.click(el('bar-cmap-rev'));
  assert.equal(cb.colormap?.reversed, false);
  assert.deepEqual(log, ['history', 'full']);
});

test('back to the figure drops the colormap; the picker hides', () => {
  const { cb } = setup();
  cb.colormap = { name: 'viridis', reversed: false };
  notify();
  fireEvent.change(el('bar-source'), { target: { value: 'figure' } });
  assert.equal(cb.colormap, null);
  assert.equal(el('bar-cmap').hidden, true);
});

test('scale select commits; Averaging clamps to 0..50 on commit; Options stays open across renders', () => {
  const { cb, log } = setup();
  fireEvent.change(el('bar-scale'), { target: { value: 'piecewise' } });
  assert.equal(cb.scale, 'piecewise');
  assert.deepEqual(log, ['history', 'full']);
  log.length = 0;
  const half = el<HTMLInputElement>('bar-halfwidth');
  fireEvent.focus(half);
  fireEvent.input(half, { target: { value: '80' } });
  assert.equal(cb.halfWidth, 50);
  fireEvent.change(half);
  assert.deepEqual(log, ['history', 'light', 'full']);
  const details = document.querySelector<HTMLDetailsElement>('details.options')!;
  details.open = true;
  notify();
  assert.equal(details.open, true);
  assert.equal(el<HTMLSelectElement>('bar-tick-mode').value, 'follow');
});

test('hotkey buttons keep their attributes', () => {
  setup();
  assert.equal(el('bar-place').dataset.hotkey, 'colorbar');
  assert.equal(el('bar-place').dataset.icon, 'place');
  assert.equal(el('tick-add').dataset.hotkey, 'ticks');
  assert.equal(el('tick-type').dataset.icon, 'type');
});

test('focusTick (interact.ts) focuses a row that exists, or the row of the next render', () => {
  const { cb, w } = setup();
  place(cb);
  cb.ticks = [{ id: 'z', x: 5, y: 0, value: 1 }];
  notify();
  w.focusTick('z');
  assert.equal(document.activeElement, valueInput(0));
  valueInput(0).blur();
  // Row not rendered yet: the request waits for the render that shows it.
  w.focusTick('late');
  assert.notEqual(document.activeElement, valueInput(0));
  act(() => {
    cb.ticks.push({ id: 'late', x: 9, y: 0, value: 1 });
    notify();
  });
  assert.equal(document.activeElement, valueInput(1));
});

test('the reference match line: levels, direction flip from the ticks, and Use its colors', () => {
  cleanup();
  const used: unknown[] = [];
  const m = {
    name: 'viridis',
    mplName: 'viridis',
    source: 'matplotlib',
    reversed: false,
    byValue: false,
    score: 0.4,
    level: 'exact' as const,
    same: ['cividis', 'plasma_r'],
  };
  const { rerender } = render(<BarMatch match={m} lowAtStart={false} onUse={(x) => used.push(x)} />);
  const line = document.getElementById('bar-match')!;
  assert.equal(line.hidden, false);
  assert.equal(line.className, 'bar-match hint exact');
  assert.equal(line.querySelector('code')!.textContent, 'viridis_r');
  assert.match(line.textContent!, /^Reference colormap: viridis_r \(.*, ΔE 0\.4\)\. Same colors: cividis_r, plasma\./);
  assert.match(line.querySelector('a')!.href, /colormaps\.html\?map=viridis#browse$/);
  fireEvent.click(screen.getByText('Use its colors'));
  assert.deepEqual(used, [m]);
  rerender(<BarMatch match={{ ...m, level: 'none' }} lowAtStart={null} onUse={() => {}} />);
  assert.match(line.textContent!, /^No known colormap matches this colorbar \(closest: viridis, ΔE 0\.4\)\. View$/);
  assert.equal(screen.queryByText('Use its colors'), null);
  rerender(<BarMatch match={null} lowAtStart={null} onUse={() => {}} />);
  assert.equal(document.getElementById('bar-match')!.hidden, true);
});

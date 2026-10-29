// @vitest-environment jsdom
// The Settings dialog end to end in jsdom: the real controller (setupSettings) with its React content under
// StrictMode, on a fake workspace. localStorage is jsdom's.
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type { SettingsUi, Workspace } from '../../types/index.ts';
import { matchingNote } from './matching-pane.tsx';
import { HOTKEY_ACTIONS } from './settings.ts';
import { setupSettings } from './settings-dialog.ts';

let dialogShown = 0;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  document.body.innerHTML = `<button id="btn-settings"></button><button id="host" data-hotkey="grid" data-title="Grid ({key})"></button>
    <dialog id="settings-dialog"></dialog>`;
  dialogShown = 0;
  const d = document.getElementById('settings-dialog') as HTMLDialogElement;
  d.showModal = () => {
    dialogShown++;
    d.setAttribute('open', '');
  };
  d.close = () => d.removeAttribute('open');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup() {
  const toasts: string[] = [];
  const applied: string[] = [];
  const changes: unknown[] = [];
  const downloads: string[] = [];
  const ws = {
    $: (id: string) => document.getElementById(id),
    toast: (m: string) => toasts.push(m),
    applyMatching: (kind: string) => applied.push(kind),
    changed: (o: unknown) => changes.push(o),
    app: { sourceCanvas: null, project: { panels: [] } },
    download: (_b: Blob, name: string) => downloads.push(name),
  } as unknown as Workspace;
  const ui: SettingsUi = setupSettings(ws);
  return { ws, ui, toasts, applied, changes, downloads };
}
const el = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLSelectElement;
const stored = () => JSON.parse(localStorage.getItem('colormeris.settings') ?? 'null');

test('nothing renders until the first open; open shows the dialog on the requested tab', () => {
  const { ui } = setup();
  assert.equal(document.querySelector('.settings-pane'), null);
  assert.equal(document.querySelectorAll('[data-settings-tab]').length, 5);
  act(() => ui.open('hotkeys'));
  assert.equal(dialogShown, 1);
  assert.equal((document.querySelector('[data-settings-pane="hotkeys"]') as HTMLElement).hidden, false);
  assert.equal((document.querySelector('[data-settings-pane="agent"]') as HTMLElement).hidden, true);
  assert.equal(document.querySelector('[data-settings-tab="hotkeys"]')!.className, 'active');
  fireEvent.click(document.querySelector('[data-settings-tab="colors"]')!);
  assert.equal((document.querySelector('[data-settings-pane="colors"]') as HTMLElement).hidden, false);
});

test('the close button is a submit button of a method=dialog form', () => {
  const { ui } = setup();
  act(() => ui.open());
  const close = document.querySelector('form.settings-head button') as HTMLButtonElement;
  assert.equal(close.type, 'submit');
  assert.equal(close.form?.getAttribute('method'), 'dialog');
});

test('hotkeys: Change, press a key, the binding is saved, the static cap and tooltip follow; Reset and Clear', async () => {
  const { ui } = setup();
  act(() => ui.open('hotkeys'));
  const row = () =>
    [...document.querySelectorAll('table.hotkeys tr')].find(
      (r) => r.children[0].textContent === 'Place grid or plot area corners',
    )!;
  const grid = HOTKEY_ACTIONS.find((a) => a.label === 'Place grid or plot area corners')!;
  assert.equal(document.getElementById('host')!.dataset.key, ui.get().hotkeys[grid.id][0] ?? '');
  const btn = (name: string) => [...row().querySelectorAll('button')].find((b) => b.textContent === name)!;
  fireEvent.click(btn('Change'));
  assert.equal(row().className, 'capturing');
  assert.match(row().children[1].textContent!, /Press a key/);
  // Esc cancels
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  assert.equal(row().className, '');
  fireEvent.click(btn('Change'));
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', bubbles: true, cancelable: true }));
  });
  assert.equal(row().className, '');
  assert.deepEqual(ui.get().hotkeys[grid.id], ['Q']);
  assert.equal(row().children[1].textContent, 'Q');
  assert.deepEqual(stored().hotkeys[grid.id], ['Q']);
  assert.equal(document.getElementById('host')!.dataset.key, 'Q');
  assert.equal(document.getElementById('host')!.title, 'Grid (Q)');
  assert.equal((btn('Reset') as HTMLButtonElement).disabled, false);
  fireEvent.click(btn('Clear'));
  assert.equal(row().children[1].textContent, 'none');
  fireEvent.click(btn('Reset'));
  assert.deepEqual(ui.get().hotkeys[grid.id], grid.keys);
  assert.equal((btn('Reset') as HTMLButtonElement).disabled, true);
});

test('hotkeys: a key used by another action that can be active together moves, with a toast', () => {
  const { ui, toasts } = setup();
  act(() => ui.open('hotkeys'));
  const rowOf = (label: string) =>
    [...document.querySelectorAll('table.hotkeys tr')].find((r) => r.children[0].textContent === label)!;
  // Crosshair takes F from Fit to view.
  fireEvent.click([...rowOf('Crosshair').querySelectorAll('button')].find((x) => x.textContent === 'Change')!);
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true, cancelable: true }));
  });
  assert.deepEqual(ui.get().hotkeys.crosshair, ['F']);
  assert.deepEqual(ui.get().hotkeys.fit, []);
  assert.deepEqual(toasts, ['F moved from “View and pages: Fit to view”.']);
  assert.equal(rowOf('Fit to view').children[1].textContent, 'none');
});

test('colors: input applies live without saving, change saves, Reset restores', () => {
  const { ui, changes } = setup();
  act(() => ui.open('colors'));
  const input = document.querySelector('.color-row input[type=color]') as HTMLInputElement;
  const label = input.getAttribute('aria-label')!;
  const row = input.closest('.color-row')!;
  const reset = row.querySelector('button') as HTMLButtonElement;
  assert.equal(reset.disabled, true);
  const before = JSON.stringify(ui.get().colors);
  fireEvent.input(input, { target: { value: '#123456' } });
  assert.notEqual(JSON.stringify(ui.get().colors), before);
  assert.deepEqual(changes.at(-1), { light: true });
  assert.equal(stored(), null);
  input.dispatchEvent(new Event('change'));
  assert.ok(stored());
  assert.equal(input.value, '#123456');
  assert.equal(reset.disabled, false);
  assert.ok(label);
  fireEvent.click(reset);
  assert.equal(JSON.stringify(ui.get().colors), before);
  assert.equal(reset.disabled, true);
});

test('agent: the key lives on the settings while typing, and is stored only with Remember', async () => {
  const { ui } = setup();
  let heard = 0;
  ui.onChange(() => heard++);
  act(() => ui.open('agent'));
  const key = el('agent-key');
  assert.equal(key.type, 'password');
  fireEvent.focus(key);
  fireEvent.input(key, { target: { value: ' sk-test ' } });
  assert.equal(ui.get().agent.key, 'sk-test');
  assert.ok(heard > 0);
  key.dispatchEvent(new Event('change'));
  assert.equal(stored().agent.key, '');
  fireEvent.click(el('agent-remember'));
  assert.equal(ui.get().agent.rememberKey, true);
  assert.equal(stored().agent.key, 'sk-test');
  fireEvent.click(el('agent-remember'));
  assert.equal(stored().agent.key, '');
});

test('agent: numbers clamp on commit, an invalid entry goes back; prompts store only changes', async () => {
  const { ui } = setup();
  act(() => ui.open('agent'));
  const steps = el('agent-steps');
  fireEvent.focus(steps);
  fireEvent.input(steps, { target: { value: '9999' } });
  steps.dispatchEvent(new Event('change'));
  assert.equal(ui.get().agent.maxSteps, 400);
  await waitFor(() => assert.equal(steps.value, '400'));
  fireEvent.input(steps, { target: { value: '' } });
  steps.dispatchEvent(new Event('change'));
  assert.equal(ui.get().agent.maxSteps, 400);
  await waitFor(() => assert.equal(steps.value, '400'));
  const prompt = el('agent-prompt');
  const builtIn = prompt.value;
  assert.ok(builtIn.length > 50);
  fireEvent.focus(prompt);
  fireEvent.input(prompt, { target: { value: 'my prompt' } });
  prompt.dispatchEvent(new Event('change'));
  assert.equal(ui.get().agent.prompt, 'my prompt');
  fireEvent.blur(prompt); // clicking a button blurs the field
  fireEvent.click(el('agent-prompt-reset'));
  assert.equal(ui.get().agent.prompt, '');
  assert.equal(el('agent-prompt').value, builtIn);
  fireEvent.input(el('agent-prompt'), { target: { value: builtIn } });
  el('agent-prompt').dispatchEvent(new Event('change'));
  assert.equal(ui.get().agent.prompt, '');
});

test('matching: a select and a number apply to the tool; Reset restores the defaults', () => {
  const { ui, applied } = setup();
  act(() => ui.open('matching'));
  fireEvent.change(el('set-hm-distance'), { target: { value: 'de76' } });
  assert.equal(ui.get().matching.heatmap.distance, 'de76');
  assert.deepEqual(applied, ['heatmap']);
  const de = el('set-roi-maxde');
  fireEvent.focus(de);
  fireEvent.input(de, { target: { value: '12.5' } });
  de.dispatchEvent(new Event('change'));
  assert.equal(ui.get().matching.roi.maxDeltaE, 12.5);
  assert.equal(stored().matching.roi.maxDeltaE, 12.5);
  fireEvent.click(el('matching-reset'));
  assert.equal(ui.get().matching.heatmap.distance, 'de2000');
  assert.equal(el('set-hm-distance').value, 'de2000');
});

test('matchingNote names panels that differ from the settings', () => {
  const m = {
    heatmap: { distance: 'de2000', maxDeltaE: 5 },
    roi: { distance: 'de2000', maxDeltaE: 5 },
    map: { distance: 'de2000', maxDeltaE: 5 },
  } as never;
  const panel = (tool: string, maxDeltaE: number) => ({ tool, settings: { distance: 'de2000', maxDeltaE } }) as never;
  assert.equal(matchingNote([panel('heatmap', 5)], m), '');
  assert.match(
    matchingNote([panel('heatmap', 7), panel('heatmap', 8), panel('roi', 9)], m),
    /^In the open project, 2 heatmap panels and 1 ROI panel use other values/,
  );
});

test('Reset keeps the key; import and export are wired', async () => {
  const { ui, toasts, downloads } = setup();
  act(() => ui.open('transfer'));
  ui.get().agent.key = 'keep-me';
  ui.get().hotkeys.grid = ['Z'];
  vi.stubGlobal('confirm', () => true);
  fireEvent.click(el('settings-reset'));
  assert.equal(ui.get().agent.key, 'keep-me');
  assert.notDeepEqual(ui.get().hotkeys.grid, ['Z']);
  assert.ok(toasts.includes('Settings reset.'));
  fireEvent.click(el('settings-export'));
  await waitFor(() => assert.deepEqual(downloads, ['colormeris-settings.zip']));
  vi.unstubAllGlobals();
});

test('the API key never reaches the DOM as an attribute or in the HTML', () => {
  const { ui } = setup();
  ui.get().agent.key = 'test-key-123';
  act(() => ui.open('agent'));
  const key = el('agent-key');
  assert.equal(key.value, 'test-key-123');
  assert.equal(key.getAttribute('value'), null);
  fireEvent.focus(key);
  fireEvent.input(key, { target: { value: ' test-key-456 ' } });
  assert.equal(ui.get().agent.key, 'test-key-456');
  assert.equal(key.getAttribute('value'), null);
  key.dispatchEvent(new Event('change'));
  fireEvent.blur(key);
  assert.equal(key.value, 'test-key-456');
  assert.ok(!document.documentElement.outerHTML.includes('test-key-'));
  // An import or reset that changes the stored key shows in the field.
  ui.get().agent.key = 'test-key-789';
  act(() => ui.save());
  assert.equal(key.value, 'test-key-789');
});

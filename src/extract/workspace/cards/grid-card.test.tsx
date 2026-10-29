// @vitest-environment jsdom
// The Grid card against a minimal workspace around createProject(): a fake history log and commit, and
// notify() from the store as the bridge. Run under StrictMode like the app.
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { setupLabelReader } from '../../../agent/ui/labels-reader.ts';
import type { Panel, ToolKind, Workspace, WorkspaceContext } from '../../../types/index.ts';
import { SettingsProvider } from '../../../ui/index.ts';
import { createProject } from '../../project/project.ts';
import { WsContext } from '../../react/use-workspace.ts';
import { defaultSettings } from '../../settings/settings.ts';
import { notify } from '../store.ts';
import { GridCard } from './grid-card.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (globalThis as { OpenRouterSDK?: unknown }).OpenRouterSDK;
});
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const corners = [
  { x: 10, y: 20 },
  { x: 110, y: 20 },
  { x: 110, y: 70 },
  { x: 10, y: 70 },
] as unknown as Panel['grid']['corners'];

function setup(opts: { kind?: ToolKind; placed?: boolean; settings?: ReturnType<typeof defaultSettings> } = {}) {
  const kind = opts.kind ?? 'heatmap';
  const log: string[] = [];
  const project = createProject(kind);
  project.activePanelId = project.panels[0].id;
  if (opts.placed) project.panels[0].grid.corners = corners;
  const app = { project, sourceCanvas: {}, mode: null as { type: string } | null, tableCell: null, keepRect: true };
  const settings = opts.settings ?? defaultSettings();
  const w = {
    app,
    activePanel: () => project.panels[0],
    tool: () => ({ kind, plotArea: kind === 'map' }),
    setMode: (m: string | null) => {
      log.push(`mode:${m}`);
      app.mode = m ? { type: m } : null;
      notify({ light: true });
    },
    pushHistory: () => log.push('history'),
    changed: (o?: { light?: boolean }) => {
      log.push(o?.light ? 'light' : 'full');
      notify({ light: o?.light });
    },
    commit: (fn: (p: Panel) => unknown) => {
      log.push('history');
      fn(project.panels[0]);
      w.changed();
    },
    applyDetectedSize: (p: Panel) => {
      log.push('detect');
      p.grid.rows = 4;
      p.grid.cols = 5;
    },
  } as unknown as WorkspaceContext;
  const ws = {
    activePanel: w.activePanel,
    pushHistory: w.pushHistory,
    changed: w.changed,
    commit: w.commit,
    viewer: { draw() {}, canvas: document.createElement('canvas'), toScreen: (p: unknown) => p },
  } as unknown as Workspace;
  const saved: string[] = [];
  const opened: string[] = [];
  setupLabelReader(ws, {
    get: () => settings,
    save: () => saved.push(settings.agent.labels ?? ''),
    open: (t?: string) => opened.push(t ?? ''),
    onChange: () => () => {},
  });
  render(
    <StrictMode>
      <WsContext.Provider value={{ ws, w }}>
        <SettingsProvider source={{ get: () => settings, onChange: () => () => {} }} mac={false}>
          <GridCard />
        </SettingsProvider>
      </WsContext.Provider>
    </StrictMode>,
  );
  return { log, project, app, panel: project.panels[0], settings, saved, opened };
}

const $ = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLButtonElement;

test('the main step shows the G cap and the shortcut tooltip, and its pressed state follows the mode', () => {
  const { app } = setup();
  const btn = $('grid-place');
  assert.equal(btn.dataset.key, 'G');
  assert.equal(btn.title, 'Shortcut: G');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  fireEvent.click(btn);
  assert.equal(app.mode?.type, 'grid');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.ok(btn.classList.contains('active'));
  // The mode bar's Esc / Cancel clears the mode through setMode(null).
  act(() => {
    app.mode = null;
    notify({ light: true });
  });
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  assert.equal($('grid-place-label').textContent, 'Place grid corners');
});

test('rows: typing keeps the draft (clear it, type 12), history once, one full change on commit', () => {
  const { panel, log } = setup({ placed: true });
  const rows = $('grid-rows');
  fireEvent.focus(rows);
  fireEvent.input(rows, { target: { value: '' } });
  assert.equal(rows.value, '');
  assert.equal(panel.grid.rows, 4);
  fireEvent.input(rows, { target: { value: '1' } });
  fireEvent.input(rows, { target: { value: '12' } });
  assert.equal(rows.value, '12');
  assert.equal(panel.grid.rows, 12);
  assert.equal(panel.grid.autoSize, false);
  assert.deepEqual(log, ['history', 'light', 'light']);
  fireEvent.change(rows);
  assert.equal(log.at(-1), 'full');
  fireEvent.input(rows, { target: { value: '5000' } });
  assert.equal(panel.grid.rows, 1000);
});

test('badge: not placed, then rows × columns; the remove button is disabled until placed', () => {
  const a = setup();
  assert.equal($('grid-state').textContent, 'not placed');
  assert.ok($('grid-state').className.includes('todo'));
  assert.equal($('grid-clear').disabled, true);
  assert.equal($('grid-detect').disabled, true);
  cleanup();
  setup({ placed: true });
  assert.equal($('grid-state').textContent, '4 × 4');
  assert.ok($('grid-state').className.includes('ok'));
  assert.equal($('grid-clear').disabled, false);
  assert.equal(a.log.length, 0);
});

test('pasting labels that do not match the size offers to set rows, and Undo-able commit follows a yes', () => {
  const { panel, log } = setup({ placed: true });
  const confirmSpy = vi.fn((_m: string) => true);
  vi.stubGlobal('confirm', confirmSpy);
  const ta = $('grid-row-labels');
  fireEvent.focus(ta);
  fireEvent.input(ta, { target: { value: 'a\nb\nc\nd\ne' } });
  assert.deepEqual(panel.grid.rowLabels, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(confirmSpy.mock.calls.length, 0);
  fireEvent.change(ta);
  assert.equal(confirmSpy.mock.calls[0][0], 'Set rows to 5 to match the labels?');
  assert.equal(panel.grid.rows, 5);
  assert.equal($('grid-rows').value, '5');
  assert.deepEqual(log.filter((l) => l === 'history').length, 2);
  // A list of the right size, or declined, changes nothing.
  confirmSpy.mockReturnValue(false);
  const cols = $('grid-col-labels');
  fireEvent.focus(cols);
  fireEvent.input(cols, { target: { value: 'x, y' } });
  fireEvent.change(cols);
  assert.equal(panel.grid.cols, 4);
  assert.match(document.querySelector('.summary-note')!.textContent!, /custom/);
});

test('anchor switch converts the corners, takes the dot defaults, starts placing and disables Detect', () => {
  const { panel, log } = setup({ placed: true });
  const select = $('grid-anchor') as unknown as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'centers' } });
  assert.equal(panel.grid.anchor, 'centers');
  assert.equal(panel.grid.shape, 'circle');
  assert.equal(panel.grid.sampleFraction, 0.7);
  assert.equal(log.at(-1), 'mode:grid');
  assert.equal($('grid-place-label').textContent, 'Place corner dots');
  assert.equal($('grid-detect').disabled, true);
  assert.match($('grid-detect').title, /dot plots lack/);
  assert.match($('grid-fraction-field').title, /own radius/);
  fireEvent.change(select, { target: { value: 'corners' } });
  assert.equal(panel.grid.shape, 'square');
  assert.equal($('grid-detect').disabled, false);
});

test('Detect rows and columns commits the detected size', () => {
  const { panel } = setup({ placed: true });
  fireEvent.click($('grid-detect'));
  assert.equal(panel.grid.rows, 4);
  assert.equal($('grid-cols').value, '5');
});

test('Remove asks first when regions are copied into every box', () => {
  const { panel } = setup({ placed: true });
  panel.rois = [{ replicate: true }] as unknown as Panel['rois'];
  const confirmSpy = vi.fn((_m: string) => false);
  vi.stubGlobal('confirm', confirmSpy);
  fireEvent.click($('grid-clear'));
  assert.ok(panel.grid.corners);
  confirmSpy.mockReturnValue(true);
  fireEvent.click($('grid-clear'));
  assert.equal(panel.grid.corners, null);
  assert.equal($('grid-state').textContent, 'not placed');
});

test('options: shape, sampled area with its percentage, and the rectangle toggle in app state', () => {
  const { panel, app } = setup();
  fireEvent.change($('grid-shape') as unknown as HTMLSelectElement, { target: { value: 'circle' } });
  assert.equal(panel.grid.shape, 'circle');
  const f = $('grid-fraction');
  fireEvent.focus(f);
  fireEvent.input(f, { target: { value: '0.8' } });
  assert.equal(panel.grid.sampleFraction, 0.8);
  assert.equal($('grid-fraction-out').textContent, '80%');
  assert.equal($('grid-rect').checked, true);
  fireEvent.click($('grid-rect'));
  assert.equal(app.keepRect, false);
  assert.equal($('grid-rect').checked, false);
});

test('Map: Plot area with its size in px, no rows or label fields shown', () => {
  setup({ kind: 'map', placed: true });
  assert.equal(document.querySelector('.card-head h2')!.textContent, 'Plot area');
  assert.equal($('grid-state').textContent, '100 × 50 px');
  assert.equal($('grid-place-label').textContent, 'Place plot area');
  assert.equal($('grid-rows').closest('.fields')!.hasAttribute('hidden'), true);
  assert.equal($('grid-detect').hidden, true);
  assert.equal($('grid-row-labels').closest('details')!.hidden, true);
  assert.equal($('grid-anchor').closest('.fields')!.hasAttribute('hidden'), true);
});

test('ROI: optional tag and Box names with their count', () => {
  const { panel } = setup({ kind: 'roi', placed: true });
  assert.equal(document.querySelector('.card-head .tag')!.textContent, 'optional');
  assert.equal($('grid-box-labels').closest('details')!.hidden, false);
  assert.equal($('grid-row-labels').closest('details')!.hidden, true);
  const ta = $('grid-box-labels');
  fireEvent.focus(ta);
  fireEvent.input(ta, { target: { value: 'B1, B2, B3' } });
  assert.deepEqual(panel.grid.boxLabels, ['B1', 'B2', 'B3']);
  assert.equal($('grid-box-labels').closest('details')!.querySelector('.summary-note')!.textContent, '3 names');
});

test('the Model field shows the labels model, saves a trimmed value on commit', () => {
  const { settings, saved } = setup();
  const model = $('agent-labels');
  assert.equal(model.getAttribute('list'), 'agent-llm-list');
  assert.ok(model.value.length > 0);
  fireEvent.focus(model);
  fireEvent.input(model, { target: { value: ' openai/x ' } });
  fireEvent.change(model);
  assert.equal(settings.agent.labels, 'openai/x');
  assert.equal(model.value, 'openai/x');
  assert.deepEqual(saved, ['openai/x']);
});

test('Read labels with AI: no key opens Settings; busy state while waiting; labels applied in one commit', async () => {
  const { panel, opened, settings, log } = setup({ placed: true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,');
  const btn = $('grid-read-labels');
  assert.equal(btn.textContent, 'Read labels with AI');
  fireEvent.click(btn);
  assert.deepEqual(opened, ['agent']);
  assert.match($('grid-read-labels-hint').textContent!, /Set an OpenRouter key/);
  assert.ok($('grid-read-labels-hint').classList.contains('error'));

  settings.agent.key = 'k';
  let finish!: (v: unknown) => void;
  (globalThis as { OpenRouterSDK?: unknown }).OpenRouterSDK = {
    OpenRouter: class {
      chat = { send: () => new Promise((r) => (finish = r)) };
    },
  };
  await act(async () => {
    fireEvent.click(btn);
  });
  assert.equal(btn.textContent, 'Reading…');
  assert.equal(btn.disabled, true);
  assert.match($('grid-read-labels-hint').textContent!, /^Asking /);
  await act(async () => {
    finish({
      choices: [
        {
          message: {
            toolCalls: [
              {
                function: {
                  name: 'set_labels',
                  arguments: JSON.stringify({ rowLabels: ['a', 'b', 'c'], colLabels: ['w', 'x', 'y', 'z'] }),
                },
              },
            ],
          },
        },
      ],
    });
  });
  assert.equal(btn.textContent, 'Read labels with AI');
  assert.equal(btn.disabled, false);
  assert.deepEqual(panel.grid.rowLabels, ['a', 'b', 'c']);
  assert.equal(($('grid-row-labels') as unknown as HTMLTextAreaElement).value, 'a\nb\nc');
  assert.equal(log.filter((l) => l === 'history').length, 1);
  assert.match($('grid-read-labels-hint').textContent!, /^Read 3 row and 4 column labels/);
});

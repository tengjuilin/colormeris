// @vitest-environment jsdom
// The ROI Regions and Results cards and the shared Scale card against a minimal workspace around
// createProject('roi'): real history-style commits, notify() from the store as the bridge, StrictMode.
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type { Panel, Workspace, WorkspaceContext } from '../../../types/index.ts';
import { SettingsProvider } from '../../../ui/index.ts';
import { createProject, createRoi } from '../../project/project.ts';
import { WsContext } from '../../react/use-workspace.ts';
import { scaleDefaults, scaleFocus } from '../../scale-bar.ts';
import { ScaleCard } from '../../scale-bar-card.tsx';
import { defaultSettings } from '../../settings/settings.ts';
import { notify } from '../../workspace/store.ts';
import type { RoiToolContext, RoiToolState } from '../roi-tool.ts';
import { RegionsCard } from './regions-card.tsx';
import { setRoiContext } from './roi-context.ts';
import { RoiResultsCard } from './roi-results-card.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(scaleDefaults, { length: 1, unit: 'cm' });
});

function setup() {
  const log: string[] = [];
  const project = createProject('roi');
  project.activePanelId = project.panels[0].id;
  const panel = project.panels[0];
  panel.rois.push(createRoi('rect', { cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.2 } as never, { name: 'ROI 1' }));
  panel.rois.push(createRoi('ellipse', { cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.2 } as never, { name: 'ROI 2' }));
  const app = { project, sourceCanvas: {}, mode: null as { type: string } | null, tableCell: null };
  const state: RoiToolState = {
    selectedId: null,
    draft: null,
    showMask: false,
    replicate: true,
    mask: null,
    metric: 'sum',
  };
  const w = {
    app,
    viewer: { requestDraw() {} },
    activePanel: () => panel,
    tool: () => ({ kind: 'roi', sections: ['sec-rois', 'sec-scale', 'sec-roi-results'] }),
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
      fn(panel);
      w.changed();
    },
  } as unknown as WorkspaceContext;
  const ws = {
    ...w,
    resultFor: () => (panel.tool === 'map' ? { rows: 3, cols: 4 } : { error: 'No colorbar yet.' }),
    toast() {},
  } as unknown as Workspace;
  const rctx = {
    ws,
    state,
    selectedRoi: () => panel.rois.find((r) => r.id === state.selectedId) ?? null,
    roiColor: () => '#f00',
    regionAt: () => null,
    deleteSelected: () => w.commit((p) => (p.rois = p.rois.filter((r) => r.id !== state.selectedId))),
    toggleTool: (t: string) => w.setMode(app.mode?.type === t ? null : t),
  } as unknown as RoiToolContext;
  setRoiContext(rctx);
  const settings = defaultSettings();
  render(
    <StrictMode>
      <WsContext.Provider value={{ ws, w }}>
        <SettingsProvider source={{ get: () => settings, onChange: () => () => {} }} mac={false}>
          <RegionsCard />
          <ScaleCard />
          <RoiResultsCard />
        </SettingsProvider>
      </WsContext.Provider>
    </StrictMode>,
  );
  return { log, panel, state, app };
}

const $ = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLButtonElement;

test('draw toggles show their key cap and follow the mode', () => {
  const { app } = setup();
  assert.equal($('tool-rect').dataset.key, 'R');
  assert.ok($('tool-rect').title.startsWith('Rectangle (R)'));
  fireEvent.click($('tool-rect'));
  assert.equal(app.mode?.type, 'rect');
  assert.equal($('tool-rect').getAttribute('aria-pressed'), 'true');
  fireEvent.click($('tool-rect'));
  assert.equal($('tool-rect').getAttribute('aria-pressed'), 'false');
  assert.equal($('roi-state').textContent, '2 regions');
});

test('chips are keyed by region id: select, rename keeps the caret, nudge reset, delete', () => {
  const { panel, state, log } = setup();
  assert.equal($('roi-edit').hidden, true);
  const chips = document.querySelectorAll('#roi-list button');
  assert.equal(chips.length, 2);
  fireEvent.click(chips[1]);
  assert.equal(state.selectedId, panel.rois[1].id);
  assert.equal($('roi-edit').hidden, false);
  assert.equal($('roi-name').value, 'ROI 2');
  const name = $('roi-name');
  fireEvent.focus(name);
  fireEvent.input(name, { target: { value: 'tumor' } });
  assert.equal(panel.rois[1].name, 'tumor');
  assert.equal(document.querySelectorAll('#roi-list .chip-label')[1].textContent, 'tumor');
  assert.equal($('roi-name'), name);
  assert.equal(log.filter((l) => l === 'history').length, 1);
  // Reset is disabled without nudges, enabled with them.
  assert.equal($('roi-reset').disabled, true);
  panel.rois[1].offsets = { '0,0': { dx: 0.1, dy: 0 } } as never;
  act(() => notify());
  assert.equal($('roi-reset').disabled, false);
  fireEvent.click($('roi-reset'));
  assert.deepEqual(panel.rois[1].offsets, {});
  fireEvent.click($('roi-delete'));
  assert.equal(panel.rois.length, 1);
  assert.equal($('roi-edit').hidden, true);
  assert.equal(document.querySelectorAll('#roi-list button').length, 1);
});

test('scale: length and unit edit the bar, measuring defaults survive removing it', () => {
  const { panel } = setup();
  assert.equal($('scale-clear').disabled, true);
  assert.equal($('scale-state').textContent, 'pixels');
  panel.scale = { p1: { x: 0, y: 0 }, p2: { x: 30, y: 40 }, length: 5, unit: 'mm' };
  act(() => notify());
  assert.equal($('scale-length').value, '5');
  assert.equal($('scale-unit').value, 'mm');
  assert.equal($('scale-info').textContent, '50.0 px = 5 mm');
  const len = $('scale-length');
  fireEvent.focus(len);
  fireEvent.input(len, { target: { value: '' } });
  assert.equal(panel.scale.length, 5);
  fireEvent.input(len, { target: { value: '2.5' } });
  assert.equal(panel.scale.length, 2.5);
  fireEvent.change($('scale-unit'), { target: { value: 'µm' } });
  assert.equal(panel.scale?.unit, 'µm');
  fireEvent.click($('scale-clear'));
  assert.equal(panel.scale, null);
  assert.equal($('scale-length').value, '2.5');
  assert.equal($('scale-unit').value, 'µm');
  assert.equal($('scale-info').textContent, '');
});

test('results: scaled metrics need a scale bar; the problem disables the downloads', () => {
  const { panel, state } = setup();
  assert.equal($('roi-result-problem').textContent, 'No colorbar yet.');
  assert.equal($('roi-dl-csv').disabled, true);
  const opt = (v: string) => document.querySelector<HTMLOptionElement>(`#result-metric option[value="${v}"]`)!;
  assert.equal(opt('area').disabled, true);
  assert.equal(opt('area').textContent, 'Region area (unit²)');
  state.metric = 'area';
  act(() => notify());
  assert.equal($('result-metric').value, 'sum');
  panel.scale = { p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, length: 1, unit: 'mm' };
  act(() => notify());
  assert.equal(opt('area').disabled, false);
  assert.equal(opt('area').textContent, 'Region area (mm²)');
  assert.equal($('result-metric').value, 'area');
  fireEvent.change($('result-metric'), { target: { value: 'max' } });
  assert.equal(state.metric, 'max');
  fireEvent.click($('toggle-mask'));
  assert.equal(state.showMask, true);
});

test('a map panel active (a render queued before the tool switch) leaves the results empty and does not throw', () => {
  const { panel } = setup();
  panel.tool = 'map';
  act(() => notify());
  assert.equal(document.querySelectorAll('#roi-result-table tr').length, 0);
  assert.equal($('roi-result-summary').textContent, '');
});

test('measuring a scale bar focuses the length field after the render', () => {
  const { panel } = setup();
  scaleFocus.pending = true;
  panel.scale = { p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, length: 1, unit: 'mm' };
  act(() => notify());
  assert.ok(document.activeElement === $('scale-length'), `active: ${document.activeElement?.id}`);
  assert.equal(scaleFocus.pending, false);
});

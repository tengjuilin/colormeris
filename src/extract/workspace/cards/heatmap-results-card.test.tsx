// @vitest-environment jsdom
// The heatmap Results card: summary, the imperative table (and that its hover highlight survives a React
// re-render), CSV buttons and Copy. A fake workspace serves a canned result.
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type { HeatmapCell, HeatmapResult, Panel, Workspace, WorkspaceContext } from '../../../types/index.ts';
import { highlightTableCell } from '../../heatmap/results-table.ts';
import { createProject } from '../../project/project.ts';
import { WsContext } from '../../react/use-workspace.ts';
import { notify } from '../store.ts';
import { HeatmapResultsCard, toTsv } from './heatmap-results-card.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const cell = (value: number, extra: Partial<HeatmapCell> = {}): HeatmapCell => ({
  rgb: [200, 30, 30],
  t: value / 10,
  value,
  deltaE: 1.234,
  flagged: false,
  status: 'ok',
  ...extra,
});

function result(): HeatmapResult {
  return {
    rows: 2,
    cols: 2,
    cells: [
      [cell(1), cell(2, { flagged: true })],
      [cell(3), cell(NaN, { status: 'off-map', reason: 'gray', rgb: [128, 128, 128] })],
    ],
    samples: [],
    scale: 'linear',
    bins: null,
    counts: { flagged: 1, offMap: 1, empty: 0, open: 0 } as HeatmapResult['counts'],
    clampedShare: 0,
  };
}

function setup(opts: { error?: string; kind?: string } = {}) {
  const project = createProject('heatmap');
  // Another tool's panel: the card gates on panel.tool (right after a switch, w.tool() may lag behind).
  if (opts.kind) project.panels[0].tool = opts.kind as (typeof project.panels)[0]['tool'];
  project.activePanelId = project.panels[0].id;
  const app = { project, sourceCanvas: {}, hoverCell: null as unknown, tableCell: null as unknown, showRecon: false };
  const state = { res: (opts.error ? { error: opts.error } : result()) as HeatmapResult | { error: string } };
  const draws: string[] = [];
  const downloads: [Blob, string][] = [];
  const toasts: string[] = [];
  const w = {
    app,
    activePanel: () => project.panels[0],
    tool: () => ({ kind: opts.kind ?? 'heatmap', sections: ['sec-hm-results'] }),
    changed: (o?: { light?: boolean }) => notify({ light: o?.light }),
    viewer: { requestDraw: () => draws.push('draw') },
  } as unknown as WorkspaceContext;
  const ws = {
    activePanel: w.activePanel,
    resultFor: () => state.res,
    download: (b: Blob, n: string) => downloads.push([b, n]),
    csvName: (_p: Panel, s = '') => `panel${s}.csv`,
    toast: (m: string) => toasts.push(m),
  } as unknown as Workspace;
  render(
    <StrictMode>
      <WsContext.Provider value={{ ws, w }}>
        <HeatmapResultsCard />
      </WsContext.Provider>
    </StrictMode>,
  );
  return { app, state, draws, downloads, toasts, panel: project.panels[0] };
}

const $ = (id: string) => document.getElementById(id) as HTMLButtonElement & HTMLInputElement;
const td = (r: number, c: number) => document.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="${c}"]`)!;

test('shows the summary and a table of values with flags and off-map cells', () => {
  setup();
  assert.match($('result-summary').textContent!, /^2 × 2 cells · range 1 – 3 · 1 not on the colorbar \(blank\)/);
  assert.match($('result-summary').textContent!, /2 flagged/);
  assert.equal(document.querySelectorAll('#result-table td').length, 4);
  assert.equal(td(0, 0).textContent, '1');
  assert.ok(td(0, 1).classList.contains('flagged'));
  assert.equal(td(1, 1).textContent, '–');
  assert.match(td(1, 1).title, /gray, not on the colorbar/);
  assert.equal(document.querySelector('#result-table th:nth-child(2)')!.textContent, 'C1');
  assert.equal($('dl-csv').disabled, false);
  assert.equal($('result-problem').textContent, '');
});

test('an error empties the table, shows the problem and disables the buttons', () => {
  setup({ error: 'Place the grid corners.' });
  assert.equal($('result-problem').textContent, 'Place the grid corners.');
  assert.equal($('result-summary').textContent, '');
  assert.equal(document.querySelectorAll('#result-table td').length, 0);
  for (const id of ['dl-csv', 'dl-long', 'copy-tsv']) assert.equal($(id).disabled, true);
});

test('hovering a cell sets the table cell; the highlight on a td survives a re-render', () => {
  const { app, draws } = setup();
  fireEvent.pointerOver(td(1, 0));
  assert.deepEqual(app.tableCell, { row: 1, col: 0 });
  assert.ok(draws.length > 0);
  fireEvent.pointerLeave(document.getElementById('result-table')!);
  assert.equal(app.tableCell, null);
  // The image hovering sets `hl` imperatively; a re-render with the same result must not drop it.
  highlightTableCell($('result-table') as unknown as HTMLElement, { row: 0, col: 1 });
  act(() => notify({ light: true }));
  assert.ok(td(0, 1).classList.contains('hl'));
  assert.equal(document.querySelectorAll('td.hl').length, 1);
});

test('the table is rebuilt only when the cached result changes, and keeps the app hover cell', () => {
  const { app, state } = setup();
  const before = td(0, 0);
  act(() => notify({ light: true }));
  assert.equal(td(0, 0), before);
  app.hoverCell = { row: 1, col: 0 };
  state.res = result();
  act(() => notify({ light: true }));
  assert.notEqual(td(0, 0), before);
  assert.ok(td(1, 0).classList.contains('hl'));
});

test('Download CSV and Long CSV give the table and the long form', () => {
  const { downloads } = setup();
  fireEvent.click($('dl-csv'));
  fireEvent.click($('dl-long'));
  assert.deepEqual(
    downloads.map(([, n]) => n),
    ['panel.csv', 'panel_long.csv'],
  );
  assert.equal(downloads[0][0].type, 'text/csv');
});

test('Copy table writes tab-separated text to the clipboard and toasts', async () => {
  const { toasts, panel, state } = setup();
  const written: string[] = [];
  vi.stubGlobal('navigator', { clipboard: { writeText: async (t: string) => written.push(t) } });
  await act(async () => {
    fireEvent.click($('copy-tsv'));
  });
  assert.equal(written[0], toTsv(panel, state.res as HeatmapResult));
  assert.ok(written[0].includes('\t'));
  assert.deepEqual(toasts, ['Table copied — paste into a spreadsheet.']);
  vi.stubGlobal('navigator', { clipboard: { writeText: async () => Promise.reject(new Error('no')) } });
  await act(async () => {
    fireEvent.click($('copy-tsv'));
  });
  assert.equal(toasts.at(-1), 'Clipboard is not available here.');
});

test('Reconstruct toggles app.showRecon and redraws', () => {
  const { app } = setup();
  assert.equal($('toggle-recon').checked, false);
  fireEvent.click($('toggle-recon'));
  assert.equal(app.showRecon, true);
  assert.equal($('toggle-recon').checked, true);
  assert.ok(document.querySelector('.card-head > .check'));
});

test("another tool's panel active: the card renders without reading results", () => {
  setup({ kind: 'roi' });
  assert.equal($('result-summary').textContent, '');
  assert.equal(document.querySelectorAll('#result-table td').length, 0);
});

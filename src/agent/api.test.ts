// @vitest-environment jsdom
// The agent API against a fake workspace: result JSON is built once per result, reviews go stale with the values.
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { rectCorners } from '../core/grid.ts';
import { createPanel, createProject } from '../extract/project/project.ts';
import type {
  HeatmapResult,
  MapResult,
  Panel,
  PanelResult,
  RoiResult,
  StateSnapshot,
  ToolKind,
  Workspace,
} from '../types/index.ts';
import { createAgentApi } from './api.ts';
import * as schema from './schema.ts';

vi.mock('./schema.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./schema.ts')>();
  return { ...mod, heatmapResultJson: vi.fn(mod.heatmapResultJson) };
});
const built = vi.mocked(schema.heatmapResultJson);
// (A block body: a function returned from beforeEach runs as its teardown.)
beforeEach(() => {
  built.mockClear();
});

// A 2 × 2 heatmap result with the given values.
function heatmapResult(values: number[]): HeatmapResult {
  const cell = (value: number) => ({ value, t: value, deltaE: 1, flagged: false, rgb: [value, 0, 0] });
  return {
    rows: 2,
    cols: 2,
    cells: [
      [cell(values[0]), cell(values[1])],
      [cell(values[2]), cell(values[3])],
    ],
    scale: 'linear',
  } as unknown as HeatmapResult;
}

// A workspace with one calibrated heatmap panel. resultFor caches like the real one: the same object while
// the panel's grid geometry, colorbar and settings are unchanged (labels are not part of the key).
function setup() {
  const project = createProject('heatmap');
  const panel = project.panels[0];
  panel.grid.corners = rectCorners({ x: 0, y: 0 }, { x: 20, y: 20 });
  panel.grid.rows = 2;
  panel.grid.cols = 2;
  project.activePanelId = panel.id;
  project.source = { page: 1, pageCount: 1, width: 100, height: 100, renderScale: 1 } as typeof project.source;
  let values = [0, 1, 2, 3];
  const cache = new Map<string, { key: string; result: PanelResult }>();
  const ws = {
    app: { project, sourceCanvas: {}, pages: new Map(), mode: null },
    zipExtras: [],
    tool: () => ({ kind: 'heatmap' }),
    activePanel: () => panel,
    currentPage: () => 1,
    canUndo: () => false,
    canRedo: () => false,
    changed: () => {},
    commit: (fn: (p: Panel) => void) => fn(panel),
    resultFor: (p: Panel) => {
      const key = JSON.stringify([p.grid.corners, p.grid.rows, p.grid.cols, p.colorbar, p.settings, values]);
      const hit = cache.get(p.id);
      if (hit?.key === key) return hit.result;
      const result = heatmapResult(values);
      cache.set(p.id, { key, result });
      return result;
    },
    reviewStatus: null,
  } as unknown as Workspace;
  const api = createAgentApi(ws);
  return { api, ws, panel, setValues: (v: number[]) => (values = v) };
}

const stateOf = (r: { ok: boolean; state?: StateSnapshot }) => r.state!;

test('state is built from one result JSON per result, rebuilt when the labels change', async () => {
  const { api } = setup();
  await api.run('get_state');
  assert.equal(built.mock.calls.length, 1);
  await api.run('get_state');
  await api.run('get_questions');
  assert.equal(built.mock.calls.length, 1);

  // Labels are outside the result key but inside the JSON.
  const r = await api.run('set_labels', { rows: ['a', 'b'] });
  assert.ok(r.ok);
  assert.equal(built.mock.calls.length, 2);
  const res = await api.run('get_results');
  assert.deepEqual((res as { result: { rowLabels: string[] } }).result.rowLabels, ['a', 'b']);
  assert.equal(built.mock.calls.length, 2);
});

test('state: false skips the snapshot of a mutating action', async () => {
  const { api } = setup();
  const r = await api.run('set_labels', { cols: ['x', 'y'] }, { state: false });
  assert.deepEqual(r, { ok: true, result: null });
  assert.equal(built.mock.calls.length, 0);
  assert.ok(stateOf(await api.run('set_labels', { cols: ['x', 'z'] })).panels.length);
});

test('a review goes stale when the values change, and results are not mutated in the cache', async () => {
  const { api, ws, panel, setValues } = setup();
  assert.ok((await api.run('set_review', { status: 'accepted' })).ok);
  assert.equal(api.reviewStatus(panel), 'accepted');
  const first = (await api.run('get_results')) as { result: Record<string, unknown> };
  assert.equal((first.result.review as { status: string }).status, 'accepted');
  setValues([3, 2, 1, 0]);
  assert.equal(api.reviewStatus(panel), 'stale');
  const st = stateOf(await api.run('set_labels', { rows: ['r1', 'r2'] }));
  assert.equal(st.panels[0].review!.status, 'stale');
  // The first answer kept what it said.
  assert.equal((first.result.review as { status: string }).status, 'accepted');
});

test('answers apply by question type: a human accept sets the review', async () => {
  const { api, ws, panel } = setup();
  const qs = (await api.run('get_questions')) as { result: { id: string; type: string }[] };
  const q = qs.result.find((x) => x.type === 'confirm_extraction')!;
  const r = await api.run('answer_question', { questionId: q.id, answer: 'accept', source: 'human' });
  assert.ok(r.ok);
  assert.equal(api.reviewStatus(panel), 'accepted');
  const after = (await api.run('get_questions')) as { result: { type: string }[] };
  assert.ok(!after.result.some((x) => x.type === 'confirm_extraction'));
});

// Map and ROI panels: get_results, get_state and get_questions on panels without heatmap values.
test('map and ROI panels: results, state and questions work, and a map review goes stale', async () => {
  const project = createProject('map');
  const map = project.panels[0];
  const roi = createPanel('Panel 2', 1, 'roi');
  project.panels.push(roi);
  project.activePanelId = map.id;
  project.source = { page: 1, pageCount: 1, width: 100, height: 100, renderScale: 1 } as typeof project.source;
  let max = 1;
  let kind: ToolKind = 'map';
  const mapResult = () =>
    ({
      rows: 2,
      cols: 2,
      bin: 1,
      xAxis: false,
      yAxis: false,
      stats: { min: 0, max, flagged: 0, clippedLow: 0, clippedHigh: 0, levels: 256 },
      profiles: {},
    }) as unknown as MapResult;
  const roiResult = {
    rows: [{ roi: { id: 'r1', name: 'ROI 1' }, row: null, col: null, outline: [], stats: { mean: 2, max: 3 } }],
    pxArea: null,
    unit: null,
  } as unknown as RoiResult;
  const cache = new Map<string, { key: number; result: PanelResult }>();
  const ws = {
    app: { project, sourceCanvas: {}, pages: new Map(), mode: null },
    zipExtras: [],
    tool: () => ({ kind }),
    setTool: (k: ToolKind) => (kind = k),
    activePanel: () => project.panels.find((p) => p.id === project.activePanelId)!,
    currentPage: () => 1,
    canUndo: () => false,
    canRedo: () => false,
    changed: () => {},
    commit: (fn: (p: Panel) => void) => fn(map),
    resultFor: (p: Panel) => {
      if (p.tool === 'roi') return roiResult;
      const hit = cache.get(p.id);
      if (hit?.key === max) return hit.result;
      const result = mapResult();
      cache.set(p.id, { key: max, result });
      return result;
    },
    reviewStatus: null,
  } as unknown as Workspace;
  const api = createAgentApi(ws);

  const m = (await api.run('get_results')) as { ok: boolean; result: { tool: string; max: number } };
  assert.ok(m.ok, JSON.stringify(m));
  assert.equal(m.result.tool, 'map');
  assert.equal(m.result.max, 1);
  const r = (await api.run('get_results', { panelId: roi.id })) as { ok: boolean; result: { regions: unknown[] } };
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.result.regions.length, 1);
  const st = (await api.run('get_state')) as { ok: boolean; result: StateSnapshot };
  assert.ok(st.ok, JSON.stringify(st));
  assert.equal(st.result.panels.length, 2);
  assert.ok((await api.run('get_questions')).ok);

  assert.ok((await api.run('set_review', { status: 'accepted', panelId: map.id })).ok);
  assert.equal(api.reviewStatus(map), 'accepted');
  max = 2;
  assert.equal(api.reviewStatus(map), 'stale');
});

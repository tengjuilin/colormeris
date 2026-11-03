// The decision tools against a fake workspace, API and decision model: only what needs no figure.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createProject } from '../extract/project/project.ts';
import type { ColormerisApi, DecideFn, Workspace } from '../types/index.ts';
import { createDecisionTools } from './decision-tools.ts';
import { newUsage } from './run-messages.ts';

function setup() {
  const project = createProject('heatmap');
  const panel = project.panels[0];
  project.activePanelId = panel.id;
  const page = {
    canvas: { width: 1000, height: 800 },
    imageData: { width: 1, height: 1, data: new Uint8ClampedArray(4) },
  };
  const ws = {
    app: { project, pages: new Map([[1, page]]) },
    currentPage: () => 1,
    activePanel: () => panel,
    pagePanels: () => project.panels,
  } as unknown as Workspace;
  const asked: string[] = [];
  const decide: DecideFn = async ({ questions }) => {
    asked.push(Object.keys(questions).join(','));
    return { answers: { present: { noul: 1 }, cells: { box: { left: 0.1, top: 0.1, right: 0.5, bottom: 0.5 } } } };
  };
  const renderView = async () => ({ dataUrl: 'data:', frame: { x0: 0, y0: 0, scale: 1, width: 1000, height: 800 } });
  const api = { run: async () => ({ ok: true, result: null }) } as unknown as ColormerisApi;
  const tools = createDecisionTools(ws, api, { renderView, decide, usage: newUsage() });
  return { tools, asked, panel };
}

const locate = (description: string) => ({ name: 'locate_heatmap', args: { name: description, description } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('prefetch asks for each locate of a turn once, and drops boxes of locates that never ran', async () => {
  const { tools, asked } = setup();
  tools.prefetch([locate('Fig 1a'), locate('Fig 1b')]);
  await settle();
  // Page box then crop box for each heatmap.
  assert.deepEqual(asked.sort(), ['cells', 'cells', 'present,cells', 'present,cells']);
  // The next turn locates the same heatmaps again (the first locates failed
  // before using their boxes): it asks afresh instead of reusing them.
  asked.length = 0;
  tools.prefetch([locate('Fig 1a'), locate('Fig 1b')]);
  await settle();
  assert.equal(asked.length, 4);
  // One locate, a page change or a box: no prefetch.
  asked.length = 0;
  tools.prefetch([locate('Fig 1a')]);
  tools.prefetch([locate('Fig 1a'), { name: 'go_to_page', args: { page: 2 } }, locate('Fig 1b')]);
  await settle();
  assert.equal(asked.length, 0);
});

test('set_ticks with box numbers needs numbered boxes (none before a colorbar is located)', async () => {
  const { tools, panel } = setup();
  panel.colorbar.start = { x: 10, y: 100 };
  panel.colorbar.end = { x: 10, y: 0 };
  const r = await tools
    .call('set_ticks', {
      ticks: [
        { mark: 1, value: 0 },
        { mark: 2, value: 1 },
      ],
    })
    .catch((e: Error) => ({ ok: false, error: e.message }));
  assert.equal(r.ok, false);
  assert.match(String(r.error), /no numbered boxes/);
});

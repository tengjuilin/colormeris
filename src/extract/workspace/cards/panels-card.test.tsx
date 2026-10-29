// @vitest-environment jsdom
// The Panels card against a minimal workspace built around createProject(): the real add / remove logic of
// panels.ts, a fake history log, and notify() from the store as the bridge.
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type { Panel, Workspace, WorkspaceContext } from '../../../types/index.ts';
import { createPanel, createProject } from '../../project/project.ts';
import { WsContext } from '../../react/use-workspace.ts';
import { setupWorkspacePanels } from '../panels.ts';
import { notify } from '../store.ts';
import { PanelsCard } from './panels-card.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function setup(opts: { pageCount?: number } = {}) {
  const log: string[] = [];
  const project = createProject('heatmap');
  project.source = { pageCount: opts.pageCount ?? 1, page: 1 } as typeof project.source;
  project.activePanelId = project.panels[0].id;
  const app = { project, sourceCanvas: {}, tableCell: 'x' as unknown, mode: null as unknown };
  const reviews = new Map<Panel, 'accepted' | 'rejected'>();
  const goTo: number[] = [];
  const w = {
    app,
    activePanel: () => project.panels.find((p) => p.id === project.activePanelId)!,
    currentPage: () => project.source?.page ?? 1,
    pagePanels: () => project.panels.filter((p) => p.page === (project.source?.page ?? 1)),
    tool: () => ({ kind: 'heatmap' }),
    toolFor: () => ({ panelProblem: (p: Panel) => (p.grid.corners ? null : 'Place the grid corners') }),
    panelDefaults: () => ({}),
    setMode: (m: unknown) => {
      app.mode = m;
    },
    pushHistory: () => log.push('history'),
    changed: (o?: { light?: boolean }) => {
      log.push(o?.light ? 'light' : 'full');
      notify({ light: o?.light });
    },
    goToPage: async (n: number) => {
      goTo.push(n);
    },
  } as unknown as WorkspaceContext;
  Object.assign(w, setupWorkspacePanels(w));
  const ws = { activePanel: w.activePanel, pushHistory: w.pushHistory, changed: w.changed } as unknown as Workspace;
  (ws as { reviewStatus: unknown }).reviewStatus = (p: Panel) => reviews.get(p) ?? null;
  render(
    <StrictMode>
      <WsContext.Provider value={{ ws, w }}>
        <PanelsCard />
      </WsContext.Provider>
    </StrictMode>,
  );
  return { log, project, app, reviews, goTo, w };
}

const chips = () => [...document.querySelectorAll<HTMLButtonElement>('#panel-list .chip')];
const nameInput = () => document.getElementById('panel-name') as HTMLInputElement;

test('renders a chip per panel on the page, selected one pressed, status dot and title from the tool', () => {
  const { project, reviews } = setup();
  const second = createPanel('Second', 1, 'heatmap');
  second.grid.corners = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ] as unknown as typeof second.grid.corners;
  project.panels.push(second);
  reviews.set(second, 'rejected');
  second.review = { note: 'bad ticks' } as typeof second.review;
  notify();
  const [a, b] = chips();
  assert.equal(chips().length, 2);
  assert.equal(a.getAttribute('aria-pressed'), 'true');
  assert.equal(b.getAttribute('aria-pressed'), 'false');
  assert.equal(a.title, 'Place the grid corners');
  assert.equal(a.querySelector('.status-dot')!.className, 'status-dot');
  assert.equal(b.title, 'Rejected in review: bad ticks');
  assert.equal(b.querySelector('.status-dot')!.className, 'status-dot rejected');
  assert.equal(nameInput().value, project.panels[0].name);
});

test('clicking another chip selects it with one full change; clicking the active one does nothing', () => {
  const { project, log, app } = setup();
  project.panels.push(createPanel('Second', 1, 'heatmap'));
  notify();
  fireEvent.click(chips()[0]);
  assert.deepEqual(log, []);
  fireEvent.click(chips()[1]);
  assert.equal(project.activePanelId, project.panels[1].id);
  assert.equal(app.tableCell, null);
  assert.deepEqual(log, ['full']);
  assert.equal(chips()[1].getAttribute('aria-pressed'), 'true');
  assert.equal(nameInput().value, 'Second');
});

test('Add makes a panel, selects it and focuses and selects its name', () => {
  const { project, log } = setup();
  fireEvent.click(screen.getByLabelText('Add a panel'));
  assert.equal(project.panels.length, 2);
  assert.equal(project.activePanelId, project.panels[1].id);
  assert.equal(log[0], 'history');
  assert.equal(chips().length, 2);
  const input = nameInput();
  assert.equal(document.activeElement, input);
  assert.equal(input.value, project.panels[1].name);
  assert.equal(input.selectionStart, 0);
  assert.equal(input.selectionEnd, input.value.length);
});

test('typing a name: history on focus, chips update live, commit is one full change', () => {
  const { project, log } = setup();
  const input = nameInput();
  fireEvent.focus(input);
  assert.deepEqual(log, []);
  fireEvent.input(input, { target: { value: 'Fig 2' } });
  assert.equal(project.panels[0].name, 'Fig 2');
  assert.equal(chips()[0].textContent, 'Fig 2');
  assert.deepEqual(log, ['history', 'light']);
  fireEvent.change(input);
  assert.deepEqual(log, ['history', 'light', 'full']);
  fireEvent.input(input, { target: { value: '' } });
  assert.equal(chips()[0].textContent, '(unnamed)');
  assert.equal(input.value, '');
  fireEvent.blur(input);
  assert.equal(input.value, '');
});

test('the delete button says Clear on the last panel and asks before removing', () => {
  const { project } = setup();
  const del = screen.getByLabelText('Clear the panel');
  assert.equal(del.title, 'Clear the panel');
  const confirmSpy = vi.fn((_message: string) => false);
  vi.stubGlobal('confirm', confirmSpy);
  const first = project.panels[0];
  fireEvent.click(del);
  assert.equal(confirmSpy.mock.calls[0][0], `Clear panel "${first.name}"? A page always keeps one panel.`);
  assert.equal(project.panels[0], first);

  confirmSpy.mockReturnValue(true);
  fireEvent.click(del);
  assert.equal(project.panels.length, 1);
  assert.notEqual(project.panels[0], first);
  assert.equal(project.panels[0].name, first.name);

  fireEvent.click(screen.getByLabelText('Add a panel'));
  assert.equal(screen.getByLabelText('Delete the panel').title, 'Delete the panel');
  const added = project.panels[1].name;
  fireEvent.click(screen.getByLabelText('Delete the panel'));
  assert.equal(confirmSpy.mock.calls.at(-1)?.[0], `Delete panel "${added}"?`);
  assert.equal(project.panels.length, 1);
  vi.unstubAllGlobals();
});

test('other pages: hidden when empty, then one chip per page that goes to the page; page note on multi-page files', () => {
  const { project, goTo } = setup({ pageCount: 3 });
  assert.equal(document.getElementById('panel-page-note')!.textContent, 'on page 1');
  const box = document.getElementById('other-pages')!;
  assert.equal(box.hidden, true);
  project.panels.push(createPanel('B', 3, 'heatmap'), createPanel('A', 2, 'heatmap'), createPanel('C', 3, 'heatmap'));
  notify();
  assert.equal(box.hidden, false);
  const links = [...box.querySelectorAll('button')];
  assert.deepEqual(
    links.map((b) => b.textContent),
    ['Page 2: A', 'Page 3: B, C'],
  );
  fireEvent.click(links[1]);
  assert.deepEqual(goTo, [3]);
  assert.equal(links[0].hasAttribute('aria-pressed'), false);
});

test('a single-page file has an empty page note', () => {
  setup();
  assert.equal(document.getElementById('panel-page-note')!.textContent, '');
});

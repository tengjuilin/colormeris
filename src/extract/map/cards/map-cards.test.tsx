// @vitest-environment jsdom
// The Map cards (Axes, Profiles, Results) against a minimal workspace around createProject('map') and a fake
// map-tool context: tick rows, the profile chips and multi-select, the sweep button, the plot hand-over and the
// results fields. Run under StrictMode like the app.
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, test } from 'vitest';
import type { Panel, Workspace, WorkspaceContext } from '../../../types/index.ts';
import { SettingsProvider } from '../../../ui/index.ts';
import { createAxisTick, createProfile, createProject } from '../../project/project.ts';
import { WsContext } from '../../react/use-workspace.ts';
import { defaultSettings } from '../../settings/settings.ts';
import { notify } from '../../workspace/store.ts';
import type { MapToolContext } from '../map-tool.ts';
import { AxesCard } from './axes-card.tsx';
import { setMapToolContext } from './map-context.ts';
import { MapResultsCard } from './map-results-card.tsx';
import { ProfilesCard } from './profiles-card.tsx';

afterEach(() => {
  cleanup();
  setMapToolContext(null);
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

const sample = (i: number) => ({
  d: i,
  len: null,
  x: null,
  y: null,
  px: i,
  py: 0,
  value: i + 1,
  deltaE: 0,
  flagged: false,
  clipped: false,
  outside: false,
});

function setup(
  Card: () => React.ReactElement,
  opts: { placed?: boolean; profiles?: number; tool?: Panel['tool'] } = {},
) {
  const log: string[] = [];
  const project = createProject('map');
  project.activePanelId = project.panels[0].id;
  const panel = project.panels[0];
  if (opts.tool) panel.tool = opts.tool;
  if (opts.placed) panel.grid.corners = corners;
  for (let i = 0; i < (opts.profiles ?? 0); i++)
    panel.map.profiles.push(
      createProfile({ x: 10, y: 30 + i * 5 }, { x: 60, y: 30 + i * 5 }, { name: `Profile ${i + 1}` }),
    );
  const app = { project, sourceCanvas: {}, mode: null as { type: string } | null, pages: new Map() };
  const state = {
    selectedId: null as string | null,
    overlay: new Set<string>(),
    profileNorm: 'raw',
    sweep: null as unknown,
    sweepSpeed: 20,
    sweepRunOff: false,
    showRecon: false,
    showFlags: false,
  };
  const w = {
    app,
    activePanel: () => panel,
    tool: () => ({ kind: 'map', sections: ['sec-axes', 'sec-profiles', 'sec-map-results'] }),
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
  const profiles: Record<string, unknown> = {};
  for (const l of panel.map.profiles) profiles[l.id] = [sample(0), sample(1), sample(2)];
  const downloads: string[] = [];
  const draws: number[] = [];
  const ws = {
    ...w,
    app,
    resultFor: () => {
      // Another tool's panel has no map field; reading one for it is the bug under test.
      if (panel.tool !== 'map') throw new Error('resultFor called for a non-map panel');
      return {
        cols: 3,
        rows: 2,
        bin: 1,
        values: new Float64Array(6),
        flags: new Uint8Array(6),
        stats: { min: 0, max: 1, levels: 5, flagged: 0, clippedLow: 0, clippedHigh: 0 },
        profiles,
      };
    },
    viewer: { requestDraw: () => draws.push(1) },
    download: (_b: Blob, n: string) => downloads.push(n),
    csvName: (_p: Panel, s = '') => `panel${s}.csv`,
  } as unknown as Workspace;
  const selection: string[] = [];
  const plotted: number[] = [];
  const mctx = {
    ws,
    state,
    selectedProfile: () => panel.map.profiles.find((l) => l.id === state.selectedId) ?? null,
    selectedProfiles: () => panel.map.profiles.filter((l) => l.id === state.selectedId || state.overlay.has(l.id)),
    isSelected: (id: string) => id === state.selectedId || state.overlay.has(id),
    selectProfile: (id: string | null, o?: { add?: boolean }) => {
      selection.push(`${id}${o?.add ? '+' : ''}`);
      if (o?.add && id) state.overlay.add(id);
      else {
        state.selectedId = id;
        state.overlay.clear();
      }
      w.changed();
    },
    profileColor: () => '#f00',
    toggleMode: (t: string) => w.setMode(t),
    deleteSelected: () => log.push('delete'),
    plot: {
      attach: () => () => {},
      redraw() {},
      drawProfiles: (_p: Panel, s: unknown[]) => plotted.push(s.length),
      setTrace() {},
    },
    sweep: {
      toggleSweep: () => {
        state.sweep = state.sweep ? null : {};
        w.changed({ light: true });
      },
      retarget() {},
      sweepValueRange: () => null,
    },
    ui: { sweepAt: null, viewSignature: null },
  } as unknown as MapToolContext;
  setMapToolContext(mctx);
  const settings = defaultSettings();
  render(
    <StrictMode>
      <WsContext.Provider value={{ ws, w }}>
        <SettingsProvider source={{ get: () => settings, onChange: () => () => {} }} mac={false}>
          <Card />
        </SettingsProvider>
      </WsContext.Provider>
    </StrictMode>,
  );
  return { log, app, panel, state, selection, plotted, downloads, draws };
}

const $ = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLButtonElement;

test('axes: the add buttons need a plot area and follow the mode; a tick row edits its value with one history entry', () => {
  const { log, panel, app } = setup(AxesCard);
  assert.ok($('axis-x-add').disabled);
  cleanup();
  const t = setup(AxesCard, { placed: true });
  assert.ok(!$('axis-x-add').disabled);
  assert.equal($('axis-x-add').dataset.key, 'X');
  fireEvent.click($('axis-x-add'));
  assert.equal(t.app.mode?.type, 'xtick');
  assert.equal($('axis-x-add').getAttribute('aria-pressed'), 'true');
  assert.equal($('axis-y-add').getAttribute('aria-pressed'), 'false');
  assert.equal(document.querySelector('table.ticks')?.hasAttribute('hidden'), true);
  act(() => {
    t.panel.map.x.ticks.push(createAxisTick({ x: 60, y: 70 }));
    notify();
  });
  const row = document.querySelector('#axis-x-ticks tr') as HTMLElement;
  const value = row.querySelector('input') as HTMLInputElement;
  assert.ok(row.classList.contains('invalid'));
  fireEvent.focus(value);
  fireEvent.input(value, { target: { value: '5' } });
  fireEvent.input(value, { target: { value: '5.5' } });
  assert.equal(t.panel.map.x.ticks[0].value, 5.5);
  assert.equal(t.log.filter((l) => l === 'history').length, 1);
  assert.ok(!row.classList.contains('invalid'));
  assert.equal(document.getElementById('axes-state')?.textContent, 'pixels');
  // The position field shows 50% across the plot area; the remove button takes the tick out.
  assert.equal((row.querySelector('.pos input') as HTMLInputElement).value, '50');
  fireEvent.click(row.querySelector('button')!);
  assert.equal(t.panel.map.x.ticks.length, 0);
  void log;
  void panel;
  void app;
});

test('profiles: chips are keyed by id, shift-click adds to the selection, the edited profile shows its fields and plot', () => {
  const t = setup(ProfilesCard, { placed: true, profiles: 2 });
  assert.equal(document.querySelectorAll('#profile-list .chip').length, 2);
  assert.ok($('profile-delete').hidden);
  assert.ok($('profile-edit').hidden);
  const chips = document.querySelectorAll<HTMLButtonElement>('#profile-list .chip');
  fireEvent.click(chips[0]);
  assert.ok(!$('profile-edit').hidden && !$('profile-delete').hidden);
  assert.equal($('profile-name').value, 'Profile 1');
  assert.equal(chips[0].getAttribute('aria-pressed'), 'true');
  assert.ok(t.plotted.at(-1) === 1);
  fireEvent.click(chips[1], { shiftKey: true });
  assert.deepEqual(t.selection, [`${t.panel.map.profiles[0].id}`, `${t.panel.map.profiles[1].id}+`]);
  assert.equal(t.plotted.at(-1), 2);
  assert.equal($('profile-csv').textContent, 'Download 2 profiles CSV');
  assert.ok(!$('profile-all').hidden === false);
  assert.equal(document.getElementById('profile-state')?.textContent, '2 profiles');
  // Typing a name edits the selected profile once in history.
  fireEvent.focus($('profile-name'));
  fireEvent.input($('profile-name'), { target: { value: 'Line A' } });
  assert.equal(t.panel.map.profiles[0].name, 'Line A');
  assert.equal(t.log.filter((l) => l === 'history').length, 1);
  fireEvent.click($('profile-csv'));
  assert.equal(t.downloads.length, 1);
});

test('profiles: the sweep button toggles through the state, and the line-at text is written to its element', () => {
  const t = setup(ProfilesCard, { placed: true, profiles: 1 });
  act(() => {
    t.state.selectedId = t.panel.map.profiles[0].id;
    notify();
  });
  const btn = $('profile-sweep');
  assert.equal(btn.textContent, 'Sweep');
  assert.equal(btn.dataset.icon, 'play');
  assert.ok($('profile-sweep-at').textContent?.startsWith('Line at y = '));
  fireEvent.click(btn);
  assert.equal(btn.textContent, 'Pause');
  assert.equal(btn.dataset.icon, 'pause');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  fireEvent.click(btn);
  assert.equal(btn.textContent, 'Sweep');
  fireEvent.input($('profile-sweep-speed'), { target: { value: '40' } });
  assert.equal(t.state.sweepSpeed, 40);
});

test('results: bin size and units commit to the panel, the toggles only redraw, downloads are enabled', () => {
  const t = setup(MapResultsCard, { placed: true });
  assert.match(document.getElementById('map-summary')!.textContent!, /^3 × 2 values \(native pixels\)/);
  fireEvent.focus($('map-bin'));
  fireEvent.input($('map-bin'), { target: { value: '4' } });
  assert.equal(t.panel.map.bin, 4);
  fireEvent.change($('map-units'), { target: { value: 'px' } });
  assert.equal(t.panel.map.units, 'px');
  const axisOpt = ($('map-units') as unknown as HTMLSelectElement).options[0];
  assert.ok(axisOpt.disabled);
  fireEvent.click($('map-recon'));
  assert.equal(t.state.showRecon, true);
  assert.ok(t.draws.length > 0);
  assert.ok($('map-recon').checked);
  // The CSVs themselves are checked in the browser; the buttons are enabled for a valid field.
  assert.ok(!$('map-dl-long').disabled && !$('map-dl-csv').disabled);
});

test("a Map card rendered with another tool's panel active (a render queued before a tool switch) shows nothing and reads no result", () => {
  for (const Card of [AxesCard, ProfilesCard, MapResultsCard]) {
    const t = setup(Card, { placed: true, profiles: 1, tool: 'roi' });
    // resultFor here would return a map field; a card that read it for an ROI panel would be wrong.
    assert.ok(document.body.textContent !== null);
    assert.equal(document.getElementById('map-summary')?.textContent ?? '', '');
    assert.ok(($('profile-edit') ?? { hidden: true }).hidden);
    void t;
    cleanup();
  }
});

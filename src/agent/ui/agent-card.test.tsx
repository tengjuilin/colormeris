// @vitest-environment jsdom
// The Agent card against a minimal workspace, a fake runner (the real runner needs a figure) and a fake API.
// Runs under StrictMode like the app. The OpenRouter SDK is a mock on globalThis; nothing leaves the test.
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { createProject } from '../../extract/project/project.ts';
import { WsContext } from '../../extract/react/use-workspace.ts';
import { defaultSettings } from '../../extract/settings/settings.ts';
import { notify } from '../../extract/workspace/store.ts';
import type { Panel, RunEventData, RunSettings, Workspace, WorkspaceContext } from '../../types/index.ts';
import { SettingsProvider } from '../../ui/index.ts';
import { AgentCard } from './agent-card.tsx';
import { setAgentDeps } from './agent-deps.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (globalThis as { OpenRouterSDK?: unknown }).OpenRouterSDK;
});
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const usage = (steps: number) => ({
  llmCost: 0.01 * steps,
  promptTokens: 100,
  cachedTokens: 50,
  cacheWriteTokens: 0,
  completionTokens: 5,
  steps,
  decisions: 0,
  decisionCost: 0,
});

function setup(opts: { key?: string; base?: string; loaded?: boolean; pageCount?: number } = {}) {
  const project = createProject('heatmap');
  project.source = { pageCount: opts.pageCount ?? 5, page: 2 } as typeof project.source;
  project.activePanelId = project.panels[0].id;
  const settings = defaultSettings();
  settings.agent.key = opts.key ?? 'test-key';
  settings.agent.base = opts.base ?? '';
  const app = { project, sourceCanvas: opts.loaded === false ? null : {} };
  const toasts: string[] = [];
  const saved: number[] = [];
  const opened: (string | undefined)[] = [];
  const reviews = new Map<Panel, string>();
  const calls: [string, unknown][] = [];
  let questions: unknown[] = [];
  const w = { app, tool: () => ({ kind: 'heatmap' }) } as unknown as WorkspaceContext;
  const ws = {
    app,
    settings,
    currentPage: () => 2,
    toast: (m: string) => toasts.push(m),
    zoomToPoints: () => {},
    reviewStatus: (p: Panel) => reviews.get(p) ?? null,
  } as unknown as Workspace;
  const runs: { s: RunSettings; finish: (v?: Error) => void }[] = [];
  const policy = { minConfidence: 0 };
  setAgentDeps({
    api: {
      policy,
      run: async (name: string, args?: unknown) => {
        calls.push([name, args]);
        return { ok: true, result: name === 'get_questions' ? questions : {} };
      },
    } as never,
    runner: {
      run: (s: RunSettings) =>
        new Promise((resolve, reject) => {
          s.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
          runs.push({ s, finish: (e) => (e ? reject(e) : resolve({ summary: 'ok', usage: usage(3) })) });
        }),
    } as never,
    settingsUi: { save: () => saved.push(1), open: (t) => opened.push(t) },
  });
  const sources: SettingsSource = { get: () => settings, onChange: () => () => {} };
  const sdkCalls: unknown[] = [];
  (globalThis as { OpenRouterSDK?: unknown }).OpenRouterSDK = {
    OpenRouter: class {
      constructor(opts: unknown) {
        sdkCalls.push(opts);
      }
    },
  };
  render(
    <StrictMode>
      <WsContext.Provider value={{ ws, w }}>
        <SettingsProvider source={sources}>
          <AgentCard />
        </SettingsProvider>
      </WsContext.Provider>
    </StrictMode>,
  );
  return {
    project,
    settings,
    app,
    toasts,
    saved,
    opened,
    reviews,
    calls,
    runs,
    policy,
    setQuestions: (q: unknown[]) => (questions = q),
  };
}
type SettingsSource = { get: () => ReturnType<typeof defaultSettings>; onChange: () => () => void };

const el = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLButtonElement;
const flush = () => act(async () => {});

test('mode toggle is pressed, saves, and shows the decision model; hidden while running', async () => {
  const { settings, saved } = setup();
  assert.equal(el('agent-mode-agent').getAttribute('aria-pressed'), 'true');
  assert.equal(el('agent-decision-field').hidden, true);
  fireEvent.click(el('agent-mode-decision'));
  assert.equal(settings.agent.mode, 'decision');
  assert.equal(saved.length, 1);
  notify();
  assert.equal(el('agent-mode-decision').getAttribute('aria-pressed'), 'true');
  assert.equal(el('agent-mode-decision').className, 'btn active');
  assert.equal(el('agent-decision-field').hidden, false);
});

test('Run is disabled without a key or proxy and without a file; the settings button opens the Agent tab', () => {
  const a = setup({ key: '' });
  assert.equal(el('agent-run').disabled, true);
  fireEvent.click(el('agent-open-settings'));
  assert.deepEqual(a.opened, ['agent']);
  cleanup();
  setup({ key: '', base: 'http://localhost:8787/api/v1' });
  assert.equal(el('agent-run').disabled, false);
  cleanup();
  setup({ loaded: false });
  assert.equal(el('agent-run').disabled, true);
  assert.equal(el('agent-status').textContent, 'Open a file first.');
});

test('model fields: commit saves the trimmed id, datalist ids exist', () => {
  const { settings, saved } = setup();
  assert.ok(document.getElementById('agent-llm-list'));
  assert.ok(document.getElementById('agent-decision-list'));
  assert.equal(el('agent-llm').getAttribute('list'), 'agent-llm-list');
  fireEvent.focus(el('agent-llm'));
  fireEvent.input(el('agent-llm'), { target: { value: ' vendor/model ' } });
  el('agent-llm').dispatchEvent(new Event('change'));
  assert.equal(settings.agent.llm, 'vendor/model');
  assert.equal(saved.length, 1);
});

test('run: passes cacheless request settings through, shows log, cost and Stop; ends with Done', async () => {
  const { runs, policy, settings } = setup();
  settings.agent.minConfidence = 0.8;
  settings.agent.maxSteps = 12;
  fireEvent.click(el('agent-run'));
  await waitFor(() => assert.equal(runs.length, 1));
  assert.equal(policy.minConfidence, 0.8);
  assert.equal(runs[0].s.maxSteps, 12);
  assert.deepEqual(runs[0].s.pages, [2]);
  assert.equal(runs[0].s.mode, 'agent');
  assert.equal(el('agent-badge').textContent, 'running');
  assert.equal(el('agent-badge').className, 'badge todo');
  assert.equal(el('agent-run').hidden, true);
  assert.equal(el('agent-stop').hidden, false);
  assert.equal(el('agent-mode-decision').disabled, true);
  assert.equal(el('agent-log').hidden, false);
  assert.match(el('agent-log').textContent!, /Running with .* on page 2\./);
  await act(async () => {
    runs[0].s.onEvent?.('tool', { name: 'get_state', args: {}, usage: usage(1) } as RunEventData);
  });
  assert.match(el('agent-log').textContent!, /Agentget_state\(\)/);
  assert.match(el('agent-status').textContent!, /^Step 1 · \$0\.01 · 50% cached · /);
  await act(async () => runs[0].finish());
  assert.equal(el('agent-badge').textContent, 'off');
  assert.equal(el('agent-run').hidden, false);
  assert.match(el('agent-status').textContent!, /^Done · Step 3 · \$0\.03/);
});

test('Stop aborts the run and ends with Stopped', async () => {
  const { runs } = setup();
  fireEvent.click(el('agent-run'));
  await waitFor(() => assert.equal(runs.length, 1));
  fireEvent.click(el('agent-stop'));
  await flush();
  assert.equal(runs[0].s.signal?.aborted, true);
  assert.match(el('agent-log').textContent!, /Stopped\./);
  assert.match(el('agent-status').textContent!, /^Stopped · /);
  assert.equal(el('agent-run').hidden, false);
});

test('a failed run says why in the log, the status and a toast', async () => {
  const { runs, toasts } = setup();
  fireEvent.click(el('agent-run'));
  await waitFor(() => assert.equal(runs.length, 1));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => runs[0].finish(Object.assign(new Error('x'), { statusCode: 402 })));
  assert.match(el('agent-log').textContent!, /no credit left/);
  assert.match(el('agent-status').textContent!, /^Failed: The OpenRouter account has no credit left \(402\)\. · /);
  assert.equal(toasts.length, 1);
});

test('pages: all pages, and a range; a bad range toasts and does not run', async () => {
  const { runs, toasts } = setup({ pageCount: 6 });
  assert.equal(el('agent-range-field').hidden, true);
  fireEvent.change(el('agent-pages'), { target: { value: 'all' } });
  fireEvent.click(el('agent-run'));
  await waitFor(() => assert.equal(runs.length, 1));
  assert.deepEqual(runs[0].s.pages, [1, 2, 3, 4, 5, 6]);
  await act(async () => runs[0].finish());
  fireEvent.change(el('agent-pages'), { target: { value: 'range' } });
  assert.equal(el('agent-range-field').hidden, false);
  fireEvent.change(el('agent-range'), { target: { value: '2-3, 5' } });
  fireEvent.click(el('agent-run'));
  await waitFor(() => assert.equal(runs.length, 2));
  assert.deepEqual(runs[1].s.pages, [2, 3, 5]);
  await act(async () => runs[1].finish());
  fireEvent.change(el('agent-range'), { target: { value: 'nope' } });
  fireEvent.click(el('agent-run'));
  await flush();
  assert.equal(runs.length, 2);
  assert.equal(toasts.length, 1);
});

test('decision mode passes the decision model and the decision prompt', async () => {
  const { runs, settings } = setup();
  settings.agent.mode = 'decision';
  notify();
  fireEvent.click(el('agent-run'));
  await waitFor(() => assert.equal(runs.length, 1));
  assert.equal(runs[0].s.mode, 'decision');
  assert.ok(runs[0].s.decide);
  assert.ok(runs[0].s.decisionModel);
});

test('Needs review: a rejected panel offers Redo (a focused run), Accept anyway and Delete', async () => {
  const { project, reviews, calls, runs } = setup();
  const panel = project.panels[0];
  panel.review = { status: 'rejected', by: 'agent', confidence: 0.4, note: '' } as Panel['review'];
  reviews.set(panel, 'rejected');
  notify();
  assert.equal(el('agent-review').hidden, false);
  const item = el('agent-review-list').querySelector('li.rejected')!;
  assert.match(item.textContent!, /was rejected by agent \(40% sure\)/);
  const note = item.querySelector('input[type=text]') as HTMLInputElement;
  fireEvent.change(note, { target: { value: ' ticks wrong ' } });
  const button = (text: string) => [...item.querySelectorAll('button')].find((b) => b.textContent === text)!;
  fireEvent.click(button('Accept anyway'));
  await flush();
  assert.deepEqual(calls.at(-1)?.[0], 'get_questions');
  assert.ok(calls.some(([n, a]) => n === 'set_review' && (a as { status: string }).status === 'accepted'));
  fireEvent.click(button('Redo with agent'));
  await waitFor(() => assert.equal(runs.length, 1));
  assert.deepEqual(runs[0].s.focus, { panelId: panel.id, note: 'ticks wrong' });
  assert.deepEqual(runs[0].s.pages, [panel.page]);
  assert.equal((button('Redo with agent') as HTMLButtonElement).disabled, true);
  assert.equal((button('Delete panel') as HTMLButtonElement).disabled, true);
});

test('Needs review: an escalated question shows the suggestion and answers with source human', async () => {
  const { project, calls, setQuestions } = setup();
  const pid = project.panels[0].id;
  setQuestions([
    {
      id: 'q1',
      type: 'classify_flagged',
      panelId: pid,
      prompt: 'Is it a cell?',
      evidence: {},
      answerSchema: { enum: ['real_cell', 'not_a_cell'] },
      escalated: { answer: 'real_cell', confidence: 0.5, source: 'agent' },
    },
  ]);
  notify();
  await waitFor(() => assert.equal(el('agent-review').hidden, false), { timeout: 2000 });
  const item = el('agent-review-list').querySelector('li')!;
  assert.match(item.textContent!, /agent suggested real_cell \(50% sure\)/);
  const [, real, notCell] = [...item.querySelectorAll('button')];
  assert.equal(real.getAttribute('aria-pressed'), 'true');
  assert.equal(notCell.hasAttribute('aria-pressed'), false);
  setQuestions([]);
  fireEvent.click(notCell);
  await flush();
  assert.deepEqual(calls.find(([n]) => n === 'answer_question')?.[1], {
    questionId: 'q1',
    answer: 'not_a_cell',
    confidence: 1,
    source: 'human',
  });
  await waitFor(() => assert.equal(el('agent-review').hidden, true));
});

test('a new rejection of the same panel starts with its own note, not the previous draft', async () => {
  const { project, reviews } = setup();
  const panel = project.panels[0];
  panel.review = { status: 'rejected', by: 'agent', note: '', resultHash: 'h1' } as never;
  reviews.set(panel, 'rejected');
  notify();
  const note = () => el('agent-review-list').querySelector('input[type=text]') as HTMLInputElement;
  fireEvent.change(note(), { target: { value: 'old draft' } });
  assert.equal(note().value, 'old draft');
  panel.review = { status: 'rejected', by: 'agent', note: '', resultHash: 'h2' } as never;
  notify();
  assert.equal(note().value, '');
});

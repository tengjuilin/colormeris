// Agent card of the heatmap tool: the mode (Agent only, or Agent decision with a decision model, see
// agent/decide.ts), model choice, running and stopping the agent, its log, and the checks left for a human
// (typed questions answered below the policy confidence through the API, and rejected panels). The key, base
// URL and limits are in the Settings dialog (settings-dialog.ts).
// The run lives in a reducer (agent-state.ts) fed by the runner's events; the status line is computed at
// render time. The OpenRouter SDK is loaded on first use (agent/openrouter-client.ts).
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { cellSamplePolygon } from '../../core/grid.ts';
import { useSectionVisible, useWorkspace } from '../../extract/react/use-workspace.ts';
import { store } from '../../extract/workspace/store.ts';
import type { AgentSettings, ColormerisApi, Panel, Question, SettingsUi, Workspace } from '../../types/index.ts';
import { Badge, BoundInput, BoundSelect, Btn, Field, Fields, Hint, useSettings } from '../../ui/index.ts';
import { DEFAULT_DECISION_MODEL } from '../decide.ts';
import { DEFAULT_LLM, parsePages } from '../llm.ts';
import { loadOpenRouterSdk, makeDecisionClient, makeOpenRouterClient } from '../openrouter-client.ts';
import { createAgentRunner } from '../runner.ts';
import { agentDeps, setAgentDeps } from './agent-deps.ts';
import { type ReviewHandlers, ReviewList } from './agent-review.tsx';
import { errorText, initialRunState, type RunState, runReducer, statusLine } from './agent-state.ts';
import { setLabelsModelFocusHandler } from './labels-reader.ts';

/** A model of OpenRouter's model list. */
interface ModelInfo {
  id: string;
  name?: string;
}

const MODES: [AgentSettings['mode'], string, string][] = [
  ['agent', 'Agent only', 'Agent only: the LLM finds, places and checks everything itself'],
  [
    'decision',
    'Agent decision',
    'Agent decision: the LLM describes each heatmap and reads its labels; a decision model locates the cells and colorbar and checks the result, and the app counts rows and columns. Fewer LLM steps and images.',
  ],
];

type PagesMode = 'current' | 'all' | 'range';

// Model lists for the pickers (public; no key needed).
async function listModels(base: string, key: string): Promise<{ llms: ModelInfo[]; deciders: ModelInfo[] }> {
  // TODO(types): models.list is outside the ChatClient slice the app types.
  // biome-ignore lint/suspicious/noExplicitAny: see above
  const client = makeOpenRouterClient(await loadOpenRouterSdk(), { key: key || undefined, base }) as any;
  const collect = async (req: object) => {
    const out: ModelInfo[] = [];
    for await (const page of await client.models.list(req)) out.push(...page.result.data);
    return out;
  };
  // The agent needs images and tools; decision models need images.
  const [llms, deciders] = await Promise.all([
    collect({ inputModalities: 'image', supportedParameters: 'tools' }),
    collect({ inputModalities: 'image', outputModalities: 'decisions' }).catch(() => []),
  ]);
  return { llms: llms.filter((m) => !m.id.endsWith(':batch')), deciders };
}

const options = (models: ModelInfo[]) => models.map((m) => <option key={m.id} value={m.id} label={m.name || m.id} />);

// The status line owns the 100 ms clock while a run goes, so the log and review list do not re-render with it.
function RunStatus({ run, loaded }: { run: RunState; loaded: boolean }) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const visible = useSectionVisible('sec-agent');
  const ticking = run.running && visible;
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [ticking]);
  return (
    <Hint id="agent-status">{run.startedAt ? statusLine(run, Date.now()) : loaded ? '' : 'Open a file first.'}</Hint>
  );
}

export function AgentCard() {
  const { ws, w } = useWorkspace({ section: 'sec-agent', light: false });
  const { settings } = useSettings();
  const agent = settings.agent;
  const { app } = w;
  const [run, dispatch] = useReducer(runReducer, initialRunState);
  const abort = useRef<AbortController | null>(null);
  const [pagesMode, setPagesMode] = useState<PagesMode>('current');
  const [range, setRange] = useState('');
  const [llms, setLlms] = useState<ModelInfo[]>([]);
  const [deciders, setDeciders] = useState<ModelInfo[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const logEl = useRef<HTMLOListElement>(null);

  const decisionMode = agent.mode === 'decision';
  const hasKeyOrProxy = !!(agent.key || agent.base); // a local proxy adds the key itself
  const loaded = !!app.sourceCanvas;
  const panelName = (id: string) => app.project.panels.find((p) => p.id === id)?.name || id;

  // ------------------------------------------------------------ models

  const modelsLoaded = useRef(false);
  const loadModels = useCallback(async () => {
    if (modelsLoaded.current) return;
    modelsLoaded.current = true;
    try {
      const { base, key } = ws.settings.agent;
      const out = await listModels(base, key);
      setLlms(out.llms);
      setDeciders(out.deciders);
    } catch (err) {
      modelsLoaded.current = false;
      console.warn('Could not list OpenRouter models', err);
    }
  }, [ws]);
  // The Model field of the Grid card (Read labels with AI) calls this on focus.
  useEffect(() => {
    setLabelsModelFocusHandler(loadModels);
    return () => setLabelsModelFocusHandler(() => {});
  }, [loadModels]);

  // ------------------------------------------------------------ status

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a line was added
  useLayoutEffect(() => {
    if (logEl.current) logEl.current.scrollTop = logEl.current.scrollHeight;
  }, [run.log.length]);

  // ------------------------------------------------------------ run

  function selectedPages() {
    const n = app.project.source!.pageCount;
    if (pagesMode === 'current') return [ws.currentPage()];
    if (pagesMode === 'all') return Array.from({ length: n }, (_, i) => i + 1);
    return parsePages(range, n);
  }

  // focus: {panelId, note} to redo one rejected panel on its own page.
  async function start(focus: { panelId: string; note?: string } | null = null) {
    if (abort.current) return;
    const { api, runner } = agentDeps();
    const cfg = ws.settings.agent;
    let pages: number[];
    try {
      pages = focus ? [app.project.panels.find((p) => p.id === focus.panelId)!.page] : selectedPages();
    } catch (err) {
      ws.toast((err as Error).message, true);
      return;
    }
    api.policy.minConfidence = cfg.minConfidence;
    const controller = new AbortController();
    abort.current = controller;
    const decision = cfg.mode === 'decision';
    const llmModel = cfg.llm.trim() || DEFAULT_LLM;
    const decisionModel = cfg.decision.trim() || DEFAULT_DECISION_MODEL;
    dispatch({ type: 'start', now: Date.now() });
    dispatch({
      type: 'line',
      cls: 'tool',
      who: 'App',
      text: `${focus ? `Redoing ${panelName(focus.panelId)}` : 'Running'} with ${llmModel}${decision ? ` and ${decisionModel}` : ''} on page${pages.length === 1 ? '' : 's'} ${pages.join(', ')}.`,
    });
    const end = (prefix: string) => dispatch({ type: 'end', now: Date.now(), prefix });
    try {
      const sdk = await loadOpenRouterSdk();
      const out = await runner.run({
        client: makeOpenRouterClient(sdk, { key: cfg.key, base: cfg.base }),
        llmModel,
        pages,
        maxSteps: cfg.maxSteps,
        systemPrompt: decision ? cfg.decisionPrompt : cfg.prompt,
        signal: controller.signal,
        onEvent: (event, data) => dispatch({ type: 'event', event, data }),
        focus,
        mode: decision ? 'decision' : 'agent',
        ...(decision ? { decide: makeDecisionClient({ key: cfg.key, base: cfg.base }), decisionModel } : {}),
      });
      dispatch({ type: 'usage', usage: out.usage });
      end('Done · ');
    } catch (err) {
      if ((err as Error).name === 'AbortError' || controller.signal.aborted) {
        dispatch({ type: 'line', cls: 'error', who: 'App', text: 'Stopped.' });
        end('Stopped · ');
      } else {
        console.error(err);
        dispatch({ type: 'line', cls: 'error', who: 'App', text: errorText(err) });
        end(`Failed: ${errorText(err)} · `);
        ws.toast(`Agent stopped: ${errorText(err)}`, true);
      }
    } finally {
      abort.current = null;
    }
  }

  // ------------------------------------------------------------ review

  // Questions come from the API (async), so they are fetched after changes settle and after a run.
  const refreshQuestions = useCallback(async () => {
    if (!w.app.sourceCanvas) return setQuestions([]);
    const r = await agentDeps().api.run('get_questions');
    setQuestions(((r.ok ? r.result : []) as Question[]).filter((q) => q.escalated));
  }, [w]);
  const version = store.getFullVersion();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` re-runs it on every full workspace change
  useEffect(() => {
    if (run.running) return;
    const id = setTimeout(() => void refreshQuestions(), 300);
    return () => clearTimeout(id);
  }, [version, run.running, refreshQuestions]);

  const rejected = app.project.panels.filter((p: Panel) => ws.reviewStatus?.(p) === 'rejected');

  const handlers: ReviewHandlers = {
    busy: run.running,
    canRun: hasKeyOrProxy,
    panelName,
    show: async (panelId, q) => {
      const { api } = agentDeps();
      await api.run('select_panel', { panelId });
      const panel = app.project.panels.find((p) => p.id === panelId);
      if (q?.type === 'classify_flagged' && panel?.grid.corners)
        ws.zoomToPoints(cellSamplePolygon(panel.grid, q.evidence.row as number, q.evidence.col as number));
      else if (panel?.grid.corners) ws.zoomToPoints(panel.grid.corners);
    },
    answer: async (q, value) => {
      const r = await agentDeps().api.run('answer_question', {
        questionId: q.id,
        answer: value,
        confidence: 1,
        source: 'human',
      });
      if (!r.ok) ws.toast(r.error, true);
      void refreshQuestions();
    },
    review: async (panelId, status) => {
      const r = await agentDeps().api.run('set_review', { panelId, status, source: 'human' });
      if (!r.ok) ws.toast(r.error, true);
      else
        ws.toast(
          status === 'rejected'
            ? `${panelName(panelId)} rejected. Fix it or use Redo with agent.`
            : `${panelName(panelId)} accepted.`,
        );
      void refreshQuestions();
    },
    // Deletes the panel with its calibration (undo restores it); the last panel of a page is cleared instead.
    remove: async (panelId) => {
      const name = panelName(panelId);
      const r = await agentDeps().api.run('remove_panel', { panelId });
      if (!r.ok) ws.toast(r.error, true);
      else
        ws.toast(
          `${name} ${(r.result as { cleared?: boolean }).cleared ? 'cleared' : 'deleted'}. Undo brings it back.`,
        );
      void refreshQuestions();
    },
    redo: (panelId, note) => void start({ panelId, note }),
  };

  const setAgent = (patch: Partial<AgentSettings>) => {
    Object.assign(ws.settings.agent, patch);
    agentDeps().settingsUi.save();
  };

  return (
    <>
      <div className="card-head">
        <h2>Agent</h2>
        <Badge id="agent-badge" text={run.running ? 'running' : 'off'} ok={run.running ? false : undefined} />
        {/* biome-ignore lint/a11y/useSemanticElements: a button group inside the card head, styled by .segmented */}
        <div className="head-actions segmented" role="group" aria-label="Agent mode">
          {MODES.map(([mode, label, title]) => (
            <Btn
              key={mode}
              id={`agent-mode-${mode}`}
              data-mode={mode}
              title={title}
              pressed={(agent.mode === 'decision' ? 'decision' : 'agent') === mode}
              disabled={run.running}
              onClick={() => setAgent({ mode })}
            >
              {label}
            </Btn>
          ))}
        </div>
      </div>
      <Btn
        id="agent-open-settings"
        block
        icon="settings"
        title="API key, base URL, confidence and step limits (Settings → Agent)"
        onClick={() => agentDeps().settingsUi.open('agent')}
      >
        API key and limits
      </Btn>
      <Fields>
        <Field label="Agent model" title="OpenRouter model id; needs vision and tool calls">
          <BoundInput
            id="agent-llm"
            list="agent-llm-list"
            spellCheck={false}
            value={agent.llm || DEFAULT_LLM}
            onFocus={() => void loadModels()}
            onCommit={(v) => setAgent({ llm: v.trim() })}
          />
          <datalist id="agent-llm-list">{options(llms)}</datalist>
        </Field>
        <Field
          label="Decision model"
          id="agent-decision-field"
          hidden={!decisionMode}
          title="OpenRouter decision model that takes images (output: decisions); answers one heatmap at a time"
        >
          <BoundInput
            id="agent-decision"
            list="agent-decision-list"
            spellCheck={false}
            value={agent.decision || DEFAULT_DECISION_MODEL}
            onFocus={() => void loadModels()}
            onCommit={(v) => setAgent({ decision: v.trim() })}
          />
          <datalist id="agent-decision-list">{options(deciders)}</datalist>
        </Field>
        <Field label="Pages">
          <BoundSelect
            id="agent-pages"
            value={pagesMode}
            onChange={(v) => setPagesMode(v as PagesMode)}
            options={[
              { value: 'current', label: 'Current page' },
              { value: 'all', label: 'All pages' },
              { value: 'range', label: 'Pages…' },
            ]}
          />
        </Field>
        <Field label="Page range" id="agent-range-field" hidden={pagesMode !== 'range'}>
          <input
            id="agent-range"
            type="text"
            placeholder="e.g. 2-4, 7"
            spellCheck={false}
            value={range}
            onChange={(e) => setRange(e.target.value)}
          />
        </Field>
      </Fields>
      <Btn
        id="agent-run"
        variant="primary"
        block
        icon="play"
        hidden={run.running}
        disabled={run.running || !loaded || !hasKeyOrProxy}
        title="An LLM finds and calibrates the heatmaps with your own OpenRouter key. Page images and extracted values are sent to OpenRouter and the model providers you pick."
        onClick={() => void start()}
      >
        Run agent
      </Btn>
      <Btn
        id="agent-stop"
        variant="danger"
        block
        icon="stop"
        hidden={!run.running}
        onClick={() => abort.current?.abort()}
      >
        Stop agent
      </Btn>
      <ReviewList questions={questions} rejected={rejected} h={handlers} />
      <ol id="agent-log" className="agent-log" hidden={!run.log.length} ref={logEl}>
        {run.log.map((l) => (
          <li key={l.id} className={l.cls}>
            <span className={`who ${l.who.toLowerCase()}`}>{l.who}</span>
            {l.text}
          </li>
        ))}
      </ol>
      <RunStatus run={run} loaded={loaded} />
    </>
  );
}

/** Give the card what it needs besides the workspace; called once at startup, after the cards are mounted. */
export function setupAgentPanel(ws: Workspace, api: ColormerisApi, settingsUi: SettingsUi) {
  const runner = createAgentRunner(ws, api);
  setAgentDeps({ api, runner, settingsUi });
  return { runner };
}

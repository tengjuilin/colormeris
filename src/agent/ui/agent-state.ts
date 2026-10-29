import type { RunEventData, RunEventType, RunUsage } from '../../types/index.ts';

// State of the Agent card's run (pure, no DOM): the log lines, the usage of the current or last run and how
// it ended. The card feeds the reducer from the runner's events; the status line is computed at render time
// from it, so the elapsed time can tick without touching the state of the run.

/** Who took a step: the Agent (the LLM), the Decision model, or the App (code). */
export type Who = 'Agent' | 'Decision' | 'App';

export interface LogLine {
  id: number;
  cls: string;
  text: string;
  who: Who;
}

export interface RunState {
  running: boolean;
  /** 0 until the first run of this visit. */
  startedAt: number;
  endedAt: number;
  usage: RunUsage | null;
  /** Shown before the step counter once the run ended: "Done · ", "Stopped · ", "Failed: … · ". */
  prefix: string;
  log: LogLine[];
  seenDecisions: number;
  nextId: number;
}

export type RunAction =
  | { type: 'start'; now: number }
  | { type: 'line'; cls: string; text: string; who: Who }
  | { type: 'event'; event: RunEventType; data: RunEventData }
  | { type: 'usage'; usage: RunUsage }
  | { type: 'end'; now: number; prefix: string };

export const initialRunState: RunState = {
  running: false,
  startedAt: 0,
  endedAt: 0,
  usage: null,
  prefix: '',
  log: [],
  seenDecisions: 0,
  nextId: 1,
};

function addLine(s: RunState, cls: string, text: string, who: Who): RunState {
  return { ...s, log: [...s.log, { id: s.nextId, cls, text, who }], nextId: s.nextId + 1 };
}

/** The log line a runner event adds, if any. `decided`: the decision model answered a request since the last event. */
export function eventLine(type: RunEventType, data: RunEventData, decided: boolean): [string, string, Who] | null {
  if (type === 'assistant') return ['assistant', data.text as string, 'Agent'];
  if (type === 'tool')
    return [
      'tool',
      `${data.name}(${data.args && Object.keys(data.args).length ? JSON.stringify(data.args) : ''})`,
      'Agent',
    ];
  if (type === 'result') return ['result', data.text as string, decided ? 'Decision' : 'App'];
  if (type === 'tool-error') return ['error', `${data.name}: ${data.error}`, 'App'];
  if (type === 'done') return ['done', data.summary as string, 'Agent'];
  return null;
}

export function runReducer(s: RunState, a: RunAction): RunState {
  switch (a.type) {
    case 'start':
      return { ...initialRunState, running: true, startedAt: a.now, nextId: s.nextId };
    case 'line':
      return addLine(s, a.cls, a.text, a.who);
    case 'usage':
      return { ...s, usage: a.usage };
    case 'event': {
      const u = a.data.usage;
      const next = { ...s, usage: u, seenDecisions: u.decisions };
      const line = eventLine(a.event, a.data, u.decisions > s.seenDecisions);
      return line ? addLine(next, ...line) : next;
    }
    case 'end':
      return { ...s, running: false, endedAt: a.now, prefix: a.prefix };
  }
}

export const money = (v: number) => (v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);

// Share of the prompt tokens read from the provider's cache.
const cacheNote = (u: RunUsage) =>
  u.promptTokens ? ` · ${Math.round((u.cachedTokens / u.promptTokens) * 100)}% cached` : '';

/** LLM cost plus the decision model's, with its number of requests. */
export const costNote = (u: RunUsage) =>
  `${money(u.llmCost + u.decisionCost)}${u.decisions ? ` (${u.decisions} decisions, ${money(u.decisionCost)})` : ''}${cacheNote(u)}`;

export const elapsed = (ms: number) => {
  const t = Math.round(ms / 100) / 10;
  return t < 60 ? `${t.toFixed(1)}s` : `${Math.floor(t / 60)}m ${(t % 60).toFixed(1).padStart(4, '0')}s`;
};

/** Step, cost and time of the current (or last) run; stays after Stop. */
export function statusLine(s: RunState, now: number) {
  const end = s.running ? now : s.endedAt;
  return `${s.prefix}Step ${s.usage?.steps ?? 0} · ${s.usage ? costNote(s.usage) : money(0)} · ${elapsed(end - s.startedAt)}`;
}

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '?' : `${Math.round(v * 100)}%`);

export function answerText(a: unknown) {
  return typeof a === 'string'
    ? a
    : a && typeof a === 'object'
      ? Object.entries(a as object)
          .map(([k, v]) => `${k} ${v}`)
          .join(', ')
      : String(a);
}

// SDK errors carry statusCode or status; the SDK's error classes are not imported here.
export function errorText(error: unknown): string {
  const err = error as { statusCode?: number; status?: number; message?: string };
  const status = err.statusCode || err.status;
  if (status === 401) return 'The API key was rejected (401).';
  if (status === 402) return 'The OpenRouter account has no credit left (402).';
  if (status === 404) return `Model not found (404): ${err.message}`;
  return err.message || String(err);
}

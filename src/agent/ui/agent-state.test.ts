import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { RunEventData, RunUsage } from '../../types/index.ts';
import { elapsed, errorText, initialRunState, money, runReducer, statusLine } from './agent-state.ts';

const usage = (over: Partial<RunUsage> = {}): RunUsage => ({
  llmCost: 0.02,
  promptTokens: 1000,
  cachedTokens: 250,
  cacheWriteTokens: 0,
  completionTokens: 10,
  steps: 2,
  decisions: 0,
  decisionCost: 0,
  ...over,
});
const data = (u: RunUsage, extra: object = {}) => ({ usage: u, ...extra }) as RunEventData;

test('a run: lines per event, who took the step, and the status line with cost, cache share and time', () => {
  let s = runReducer(initialRunState, { type: 'start', now: 1000 });
  s = runReducer(s, { type: 'event', event: 'assistant', data: data(usage(), { text: 'Looking' }) });
  s = runReducer(s, { type: 'event', event: 'tool', data: data(usage(), { name: 'locate', args: { a: 1 } }) });
  s = runReducer(s, { type: 'event', event: 'tool', data: data(usage(), { name: 'finish', args: {} }) });
  // The decision count went up since the last event: the result is the decision model's.
  s = runReducer(s, {
    type: 'event',
    event: 'result',
    data: data(usage({ decisions: 1, decisionCost: 0.005 }), { text: 'ok' }),
  });
  s = runReducer(s, {
    type: 'event',
    event: 'result',
    data: data(usage({ decisions: 1, decisionCost: 0.005 }), { text: 'again' }),
  });
  s = runReducer(s, {
    type: 'event',
    event: 'tool-error',
    data: data(usage({ decisions: 1, decisionCost: 0.005 }), { name: 'x', error: 'bad' }),
  });
  assert.deepEqual(
    s.log.map((l) => [l.cls, l.who, l.text]),
    [
      ['assistant', 'Agent', 'Looking'],
      ['tool', 'Agent', 'locate({"a":1})'],
      ['tool', 'Agent', 'finish()'],
      ['result', 'Decision', 'ok'],
      ['result', 'App', 'again'],
      ['error', 'App', 'x: bad'],
    ],
  );
  assert.equal(s.log.length, new Set(s.log.map((l) => l.id)).size);
  assert.equal(statusLine(s, 3500), 'Step 2 · $0.03 (1 decisions, $0.0050) · 25% cached · 2.5s');
  s = runReducer(s, { type: 'end', now: 4000, prefix: 'Done · ' });
  assert.equal(s.running, false);
  assert.equal(statusLine(s, 99999), 'Done · Step 2 · $0.03 (1 decisions, $0.0050) · 25% cached · 3.0s');
});

test('a new run clears the log and keeps line ids unique', () => {
  let s = runReducer(initialRunState, { type: 'start', now: 1 });
  s = runReducer(s, { type: 'line', cls: 'tool', text: 'a', who: 'App' });
  const id = s.log[0].id;
  s = runReducer(s, { type: 'start', now: 2 });
  assert.deepEqual(s.log, []);
  s = runReducer(s, { type: 'line', cls: 'tool', text: 'b', who: 'App' });
  assert.ok(s.log[0].id > id);
});

test('formatting helpers', () => {
  assert.equal(money(0.004), '$0.0040');
  assert.equal(money(0.5), '$0.50');
  assert.equal(elapsed(75_300), '1m 15.3s');
  assert.equal(errorText({ statusCode: 401 }), 'The API key was rejected (401).');
  assert.equal(errorText({ status: 404, message: 'x' }), 'Model not found (404): x');
  assert.equal(errorText(new Error('boom')), 'boom');
});

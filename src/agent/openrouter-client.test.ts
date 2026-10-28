import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';

// agent/openrouter-client.ts is a browser file: its decision client only needs
// fetch and location, stubbed here.
vi.stubGlobal('location', { protocol: 'http:', origin: 'http://localhost:8000' });
const { makeDecisionClient } = await import('./openrouter-client.ts');

afterEach(() => {
  vi.useRealTimers();
});

const reply = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  statusText: String(status),
  json: async () => body,
});

test('makeDecisionClient retries once after a 5xx or a network error', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  const answers = { answers: { a: { choice: 'x' } } };
  for (const first of [
    () => reply(502, { error: { message: 'Upstream request failed' } }),
    () => Promise.reject(new TypeError('fetch failed')),
  ]) {
    const calls: unknown[] = [];
    globalThis.fetch = (async (url: unknown) => (
      calls.push(url), calls.length === 1 ? first() : reply(200, answers)
    )) as unknown as typeof fetch;
    const pending = makeDecisionClient({ base: 'http://localhost:8787/api/v1' })({
      model: 'm',
      state: [],
      questions: {},
    });
    await new Promise((r) => setImmediate(r));
    vi.advanceTimersByTime(2000);
    assert.deepEqual(await pending, answers);
    assert.equal(calls.length, 2);
    assert.equal(calls[0], 'http://localhost:8787/api/alpha/decisions');
  }
});

test('makeDecisionClient does not retry a 4xx', async () => {
  let n = 0;
  globalThis.fetch = (async () => (n++, reply(400, { error: { message: 'bad question' } }))) as unknown as typeof fetch;
  await assert.rejects(makeDecisionClient()({ state: [], questions: {} }), /bad question \(400\)/);
  assert.equal(n, 1);
});

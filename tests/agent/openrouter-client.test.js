import { test } from 'node:test';
import assert from 'node:assert/strict';

// agent/openrouter-client.js is a browser file (not in tests/load.js): its
// decision client only needs fetch and location, stubbed here.
globalThis.location ??= { protocol: 'http:', origin: 'http://localhost:8000' };
await import('../../assets/js/agent/openrouter-client.js');
const CM = globalThis.Colormeris;

const reply = (status, body) => ({ ok: status < 400, status, statusText: String(status), json: async () => body });

test('makeDecisionClient retries once after a 5xx or a network error', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const answers = { answers: { a: { choice: 'x' } } };
  for (const first of [() => reply(502, { error: { message: 'Upstream request failed' } }), () => Promise.reject(new TypeError('fetch failed'))]) {
    const calls = [];
    globalThis.fetch = async (url) => (calls.push(url), calls.length === 1 ? first() : reply(200, answers));
    const pending = CM.makeDecisionClient({ base: 'http://localhost:8787/api/v1' })({ model: 'm', state: [], questions: {} });
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(2000);
    assert.deepEqual(await pending, answers);
    assert.equal(calls.length, 2);
    assert.equal(calls[0], 'http://localhost:8787/api/alpha/decisions');
  }
});

test('makeDecisionClient does not retry a 4xx', async () => {
  let n = 0;
  globalThis.fetch = async () => (n++, reply(400, { error: { message: 'bad question' } }));
  await assert.rejects(CM.makeDecisionClient()({}), /bad question \(400\)/);
  assert.equal(n, 1);
});

// @vitest-environment jsdom
// The shared model-list store with a mock SDK: loaded once by whichever field gets focus first, again after a failure.
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';

type Req = { outputModalities?: string };

function mockSdk(fail: () => boolean, requests: Req[]) {
  return {
    OpenRouter: class {
      get models() {
        return {
          list: async (req: Req) => {
            requests.push(req);
            if (fail()) throw new Error('offline');
            const data =
              req.outputModalities === 'decisions'
                ? [{ id: 'typesafe/jev-1.14' }]
                : [{ id: 'a/llm', name: 'LLM' }, { id: 'a/llm:batch' }];
            return (async function* () {
              yield { result: { data } };
            })();
          },
        };
      }
    },
  };
}

afterEach(() => {
  delete (globalThis as { OpenRouterSDK?: unknown }).OpenRouterSDK;
  vi.resetModules();
});

test('the lists load once; a failed load is retried on the next call', async () => {
  const { loadModelLists, useModelLists } = await import('./model-lists.ts');
  let offline = true;
  const requests: Req[] = [];
  (globalThis as { OpenRouterSDK?: unknown }).OpenRouterSDK = mockSdk(() => offline, requests);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const settings = { base: '', key: '' };

  await loadModelLists(settings);
  assert.equal(warn.mock.calls.length, 1);
  offline = false;
  await loadModelLists(settings);
  const after = requests.length;
  await loadModelLists(settings); // already loaded: nothing asked
  assert.equal(requests.length, after);
  warn.mockRestore();

  // The hook reads the same snapshot every component gets (':batch' variants dropped).
  const { renderHook } = await import('@testing-library/react');
  const { result } = renderHook(() => useModelLists());
  assert.deepEqual(
    result.current.llms.map((m) => m.id),
    ['a/llm'],
  );
  assert.deepEqual(
    result.current.deciders.map((m) => m.id),
    ['typesafe/jev-1.14'],
  );
});

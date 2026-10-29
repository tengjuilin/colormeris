// @vitest-environment jsdom
// The bridge: a full notify renders subscribers at once (flushSync), a light one leaves it to React's batching.
import assert from 'node:assert/strict';
import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test } from 'vitest';
import { notify, store } from './store.ts';

let host: HTMLElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  host = document.createElement('div');
});
afterEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function Version() {
  const v = useSyncExternalStore(store.subscribe, store.getVersion);
  return <output>{v}</output>;
}

function mount() {
  const root = createRoot(host);
  flushSync(() => root.render(<Version />));
  return root;
}

test('notify bumps the version and calls subscribers', () => {
  const before = store.getVersion();
  let calls = 0;
  const off = store.subscribe(() => calls++);
  notify();
  notify({ light: true });
  off();
  notify();
  assert.equal(store.getVersion(), before + 3);
  assert.equal(calls, 2);
});

test('a full notify updates the DOM before it returns', () => {
  const root = mount();
  const v = store.getVersion();
  notify();
  assert.equal(host.querySelector('output')!.textContent, String(v + 1));
  flushSync(() => root.unmount());
});

test('a light notify leaves the render to React', async () => {
  const root = mount();
  const v = store.getVersion();
  notify({ light: true });
  assert.equal(host.querySelector('output')!.textContent, String(v));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(host.querySelector('output')!.textContent, String(v + 1));
  flushSync(() => root.unmount());
});

test('a light notify leaves the full version alone', () => {
  const full = store.getFullVersion();
  notify({ light: true });
  assert.equal(store.getFullVersion(), full);
  notify();
  assert.equal(store.getFullVersion(), full + 1);
});

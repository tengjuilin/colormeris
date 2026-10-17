(function (CM) {
  'use strict';

  // The OpenRouter SDK (assets/vendor/openrouter), loaded on first use, and
  // clients for it. Shared by the Agent card and the label reader.

  const SDK_SRC = 'assets/vendor/openrouter/openrouter.min.js';

  let sdkPromise = null;
  function loadOpenRouterSdk() {
    if (globalThis.OpenRouterSDK) return Promise.resolve(globalThis.OpenRouterSDK);
    sdkPromise ??= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK_SRC;
      s.onload = () => resolve(globalThis.OpenRouterSDK);
      s.onerror = () => {
        sdkPromise = null;
        reject(new Error('Could not load the OpenRouter SDK.'));
      };
      document.head.append(s);
    });
    return sdkPromise;
  }

  function makeOpenRouterClient(sdk, { key, base } = {}) {
    return new sdk.OpenRouter({
      // Behind a proxy the key can be empty; the proxy replaces this header.
      apiKey: key || 'proxy',
      appTitle: 'Colormeris',
      ...(location.protocol.startsWith('http') ? { httpReferer: location.origin } : {}),
      ...(base ? { serverURL: base } : {}),
    });
  }

  // Decision models (Jev and others) through OpenRouter's Decisions API,
  // POST /api/alpha/decisions. Plain fetch: the vendored SDK has no "box"
  // question type and sends decisions to openrouter.ai whatever the base URL.
  // With a base URL (a local proxy) the request goes to that origin instead.
  // decide({model, state, questions}, {signal}) → {answers, usage: {cost}}.
  function makeDecisionClient({ key, base } = {}) {
    const origin = base ? new URL(base).origin : 'https://openrouter.ai';
    return async function decide(body, { signal } = {}) {
      const res = await fetch(`${origin}/api/alpha/decisions`, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key || 'proxy'}`,
          'x-title': 'Colormeris',
          ...(location.protocol.startsWith('http') ? { 'http-referer': location.origin } : {}),
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.answers) {
        const err = new Error(`Decision model: ${json.error?.message || res.statusText || 'no answers'} (${res.status})`);
        err.status = res.status;
        throw err;
      }
      return json;
    };
  }

  Object.assign(CM, { loadOpenRouterSdk, makeOpenRouterClient, makeDecisionClient });
})((globalThis.Colormeris ??= {}));

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

  Object.assign(CM, { loadOpenRouterSdk, makeOpenRouterClient });
})((globalThis.Colormeris ??= {}));

import type { ChatClient, DecideFn, DecisionRequest, DecisionResponse, OpenRouterSdk } from '../types/index.ts';

/** An Error from the decision client: HTTP status, or network for a failed fetch. */
type DecisionError = Error & { status?: number; network?: boolean };

// The OpenRouter SDK (npm @openrouter/sdk), loaded on first use, and
// clients for it. Shared by the Agent card and the label reader.

const RETRY_MS = 1500;

let sdkPromise: Promise<OpenRouterSdk> | null = null;
// A test or mock that set globalThis.OpenRouterSDK wins; else the npm package
// is imported lazily (its own chunk).
export function loadOpenRouterSdk(): Promise<OpenRouterSdk> {
  if (globalThis.OpenRouterSDK) return Promise.resolve(globalThis.OpenRouterSDK);
  sdkPromise ??= import('@openrouter/sdk').then(
    (sdk) => sdk as unknown as OpenRouterSdk, // TODO(types): the SDK client's real types are wider than ChatClient
    (err) => {
      sdkPromise = null;
      throw new Error(`Could not load the OpenRouter SDK (${err?.message || err}).`);
    },
  );
  return sdkPromise;
}

export function makeOpenRouterClient(
  sdk: OpenRouterSdk,
  { key, base }: { key?: string; base?: string } = {},
): ChatClient {
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
export function makeDecisionClient({ key, base }: { key?: string; base?: string } = {}): DecideFn {
  const origin = base ? new URL(base).origin : 'https://openrouter.ai';
  // One quick retry on a network error or a 5xx: Jev once answered 502
  // "Upstream request failed", which cost a minute and an LLM step.
  return async function decide(body, { signal } = {}) {
    try {
      return await decideOnce(body, signal);
    } catch (err) {
      const e = err as DecisionError;
      if (signal?.aborted || !((e.status ?? 0) >= 500 || e.network)) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      if (signal?.aborted) throw err;
      return decideOnce(body, signal);
    }
  };
  async function decideOnce(body: DecisionRequest, signal: AbortSignal | undefined): Promise<DecisionResponse> {
    let res: Response;
    try {
      res = await fetchDecision(body, signal);
    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError') throw err;
      throw Object.assign(new Error(`Decision model: ${e.message}`), { network: true });
    }
    const json = await res.json().catch(() => ({}) as Record<string, any>); // TODO(types): untyped JSON from the API
    if (!res.ok || !json.answers) {
      const err: DecisionError = new Error(
        `Decision model: ${json.error?.message || res.statusText || 'no answers'} (${res.status})`,
      );
      err.status = res.status;
      throw err;
    }
    return json;
  }
  function fetchDecision(body: DecisionRequest, signal: AbortSignal | undefined) {
    return fetch(`${origin}/api/alpha/decisions`, {
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
  }
}

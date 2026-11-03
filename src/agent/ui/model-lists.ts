// OpenRouter's model lists for the model pickers: the Agent card's LLM and decision-model fields and the Grid
// card's labels Model field share one datalist. Loaded once, on the first focus of any of those fields (public
// lists, no key needed); a failed load may be retried on the next focus. Components read the lists with
// useModelLists(); the Grid card's field calls loadModelLists through labels-reader.ts, so no card has to
// register a handler with another.
import { useSyncExternalStore } from 'react';
import { loadOpenRouterSdk, makeOpenRouterClient } from '../openrouter-client.ts';

/** A model of OpenRouter's model list. */
export interface ModelInfo {
  id: string;
  name?: string;
}

export interface ModelLists {
  llms: ModelInfo[];
  deciders: ModelInfo[];
}

let lists: ModelLists = { llms: [], deciders: [] };
let loading = false;
const listeners = new Set<() => void>();

async function fetchLists(base: string, key: string): Promise<ModelLists> {
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

/** Load the lists once (with the Agent's base URL and key); later calls do nothing unless the first failed. */
export async function loadModelLists({ base, key }: { base: string; key: string }) {
  if (loading) return;
  loading = true;
  try {
    lists = await fetchLists(base, key);
    for (const l of listeners) l();
  } catch (err) {
    loading = false;
    console.warn('Could not list OpenRouter models', err);
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The lists as loaded so far (empty before the first focus). */
export const useModelLists = () => useSyncExternalStore(subscribe, () => lists);

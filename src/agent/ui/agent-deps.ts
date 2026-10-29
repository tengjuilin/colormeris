import type { ColormerisApi, SettingsUi } from '../../types/index.ts';
import type { createAgentRunner } from '../runner.ts';

// What the Agent card (React) needs besides the workspace: the typed API, the runner that drives it and the
// settings dialog's save and open. setupAgentPanel gives them once at startup, after the cards are mounted
// (the API does not exist before); the card reads them when a handler runs, never during render.

export interface AgentDeps {
  api: ColormerisApi;
  runner: Pick<ReturnType<typeof createAgentRunner>, 'run'>;
  settingsUi: Pick<SettingsUi, 'save' | 'open'>;
}

let deps: AgentDeps | null = null;

export const setAgentDeps = (d: AgentDeps) => {
  deps = d;
};

export function agentDeps(): AgentDeps {
  if (!deps) throw new Error('The agent is not set up yet');
  return deps;
}

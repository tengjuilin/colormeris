// Agent pane of the Settings dialog: the OpenRouter key and base URL, the limits, and the prompts. The key
// is only stored when Remember is ticked (settings-dialog.ts save), otherwise it lasts for this visit.

import { DECISION_SYSTEM_PROMPT } from '../../agent/decide.ts';
import { LABELS_PROMPT } from '../../agent/labels.ts';
import { AGENT_SYSTEM_PROMPT } from '../../agent/llm.ts';
import type { AgentSettings } from '../../types/index.ts';
import { BoundInput, Btn, Check, Field, parseNumber, SecretInput, useSettings } from '../../ui/index.ts';
import { useSettingsCtl } from './settings-ctl.ts';

type PromptKey = 'prompt' | 'labelsPrompt' | 'decisionPrompt';

// Prompts show the built-in text when not customized; saving it unchanged (or empty) stores '' so later
// versions of the built-in prompt still apply.
const PROMPTS: { id: string; key: PromptKey; label: string; title: string; rows: number; fallback: () => string }[] = [
  {
    id: 'agent-prompt',
    key: 'prompt',
    label: 'Agent prompt',
    title: 'System prompt of the extraction agent (Run agent)',
    rows: 10,
    fallback: () => AGENT_SYSTEM_PROMPT || '',
  },
  {
    id: 'agent-decision-prompt',
    key: 'decisionPrompt',
    label: 'Agent decision prompt',
    title: 'System prompt of the LLM in Agent decision mode',
    rows: 10,
    fallback: () => DECISION_SYSTEM_PROMPT || '',
  },
  {
    id: 'agent-labels-prompt',
    key: 'labelsPrompt',
    label: 'Label reader prompt',
    title: 'System prompt of Read labels with AI (Grid card)',
    rows: 6,
    fallback: () => LABELS_PROMPT || '',
  },
];

export function AgentPane() {
  const ctl = useSettingsCtl();
  const { settings } = useSettings();
  const a = settings.agent;

  // Numbers apply on change; an empty or invalid entry goes back to the stored value.
  const number =
    (key: 'minConfidence' | 'maxSteps', lo: number, hi: number, round = false) =>
    (text: string) => {
      const v = parseNumber(text);
      if (v === null) return;
      const clamped = Math.min(hi, Math.max(lo, v));
      ctl.settings.agent[key] = round ? Math.round(clamped) : clamped;
      ctl.changed();
    };

  return (
    <>
      <Field label="OpenRouter API key (required)">
        <SecretInput
          id="agent-key"
          spellCheck={false}
          placeholder="sk-or-…"
          read={() => ctl.settings.agent.key}
          onInput={(v) => {
            ctl.settings.agent.key = v;
            ctl.notifyOnly();
          }}
          onCommit={() => ctl.changed()}
        />
      </Field>
      <Check
        small
        id="agent-remember"
        label="Remember the key in this browser"
        checked={a.rememberKey}
        onChange={(v) => {
          ctl.settings.agent.rememberKey = v;
          ctl.changed();
        }}
      />
      <div className="row">
        <Field
          label="Min. confidence"
          title="Answers to typed questions below this confidence (given through the API) are left for you under Needs review"
        >
          <BoundInput
            id="agent-minconf"
            kind="number"
            min={0}
            max={1}
            step={0.01}
            className="num"
            value={a.minConfidence}
            onCommit={number('minConfidence', 0, 1)}
          />
        </Field>
        <Field label="Max. steps" title="The run stops after this many LLM calls">
          <BoundInput
            id="agent-steps"
            kind="number"
            min={5}
            max={400}
            className="num"
            value={a.maxSteps}
            onCommit={number('maxSteps', 5, 400, true)}
          />
        </Field>
      </div>
      <Field label="API base URL (optional)">
        <BoundInput
          id="agent-base"
          kind="url"
          spellCheck={false}
          placeholder="https://openrouter.ai/api/v1"
          value={a.base}
          onInput={(v) => {
            ctl.settings.agent.base = v.trim();
            ctl.notifyOnly();
          }}
          onCommit={() => ctl.changed()}
        />
      </Field>
      <p className="muted small">
        Get a key at{' '}
        <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">
          openrouter.ai/keys
        </a>
        . Without <i>Remember</i>, the key is forgotten when you close the page. The base URL is for
        OpenRouter-compatible proxies (such as <code>npm run proxy</code> at <code>http://localhost:8787/api/v1</code>,
        which adds the key itself); leave it empty otherwise.
      </p>
      <h3>Prompts</h3>
      <p className="muted small">
        The instructions sent to the models. Edits are saved with the settings; <i>Reset</i> goes back to the built-in
        text.
      </p>
      {PROMPTS.map((p) => (
        <PromptField key={p.id} p={p} value={a[p.key as keyof AgentSettings] as string} />
      ))}
    </>
  );
}

function PromptField({ p, value }: { p: (typeof PROMPTS)[number]; value: string }) {
  const ctl = useSettingsCtl();
  const set = (v: string) => {
    ctl.settings.agent[p.key] = v;
    ctl.changed();
  };
  return (
    <>
      <Field label={p.label} title={p.title}>
        <BoundInput
          id={p.id}
          kind="textarea"
          rows={p.rows}
          spellCheck={false}
          value={value || p.fallback()}
          onCommit={(text) => {
            const v = text.trim();
            set(v === p.fallback().trim() ? '' : v);
          }}
        />
      </Field>
      <div className="row">
        <Btn id={`${p.id}-reset`} onClick={() => set('')}>
          {`Reset ${p.label.toLowerCase()}`}
        </Btn>
      </div>
    </>
  );
}

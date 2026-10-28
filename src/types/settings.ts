// App settings (extract/settings/settings.ts): the agent connection, matching
// defaults per tool, hotkeys and overlay colors. They belong to the user, not
// to a figure, and live in localStorage and settings zips.

import type { DistanceName } from './image.ts';
import type { ToolKind } from './project.ts';

/** "agent": the LLM does everything; "decision": the LLM asks a decision model (agent/decide.ts). */
export type AgentMode = 'agent' | 'decision';

/** Agent card settings; empty strings mean the built-in default. */
export interface AgentSettings {
  key: string;
  /** Keep the key in localStorage. */
  rememberKey: boolean;
  minConfidence: number;
  maxSteps: number;
  /** API base URL (a local proxy), or ''. */
  base: string;
  llm: string;
  /** Model of Read labels with AI. */
  labels: string;
  prompt: string;
  labelsPrompt: string;
  mode: AgentMode;
  /** Decision model id. */
  decision: string;
  decisionPrompt: string;
}

/** Matching defaults of one tool; only the ROI tool has grayChroma. */
export interface MatchingSettings {
  distance: DistanceName;
  maxDeltaE: number;
  grayChroma?: number;
}

/** Overlay color: #rrggbb, or a palette that items take in turn. */
export type ColorValue = string | string[];

export interface Settings {
  agent: AgentSettings;
  matching: Record<ToolKind, MatchingSettings>;
  /** Action id → combos such as "G" or "Mod+Shift+Z". */
  hotkeys: Record<string, string[]>;
  /** COLOR_ITEMS id → color. */
  colors: Record<string, ColorValue>;
}

/** A section of the Settings dialog (HOTKEY_GROUPS, COLOR_GROUPS). */
export interface SettingsGroup {
  id: string;
  label: string;
}

/** A hotkey action (HOTKEY_ACTIONS). `tool` limits it to one tool; `always` runs it before a file is open. */
export interface HotkeyAction {
  id: string;
  group: string;
  label: string;
  keys: string[];
  tool?: ToolKind;
  always?: boolean;
}

/** An overlay color (COLOR_ITEMS); `value` is the default. */
export interface ColorItem {
  id: string;
  group: string;
  label: string;
  value: ColorValue;
}

/** What setupSettings (settings-dialog.ts) returns to the Agent card and the label reader. */
export interface SettingsUi {
  get: () => Settings;
  save: () => void;
  open: (tab?: string) => void;
  onChange: (fn: () => void) => void;
}

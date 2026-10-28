// Shapes shared by the agent layer: the typed actions (agent/schema.ts), the
// window.colormeris API (agent/api.ts), the LLM chat loop (agent/runner.ts)
// and the decision model (agent/decide.ts, agent/decision-tools.ts,
// agent/openrouter-client.ts). Results the LLM only reads stay loose.

import type { Point } from './image.ts';
import type { ColorbarScale, ColormapRef, PanelSettings, ToolKind } from './project.ts';

// ---------------------------------------------------------------- JSON Schema

/** The subset of JSON Schema that schema.ts validates (validate) and sends to LLMs. */
export interface JsonSchema {
  type?: 'object' | 'array' | 'number' | 'integer' | 'string' | 'boolean';
  description?: string;
  enum?: readonly unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  maxLength?: number;
}

/** An action of the catalogue (ACTIONS, RUNNER_TOOLS, DECISION_TOOLS): its arguments' schema. */
export interface ActionSpec {
  description: string;
  args: JsonSchema;
  /** Mutating actions are logged and return the new state. */
  mutates?: boolean;
}

/** Arguments of an action as sent; validate checks them against ActionSpec.args. */
export type ActionArgs = Record<string, unknown>;

/** normalizeArgs output: forgiving fixes, with notes for the LLM. */
export interface NormalizedArgs {
  args: ActionArgs;
  notes: string[];
}

/** toolDefinitions(): the catalogue in the format LLM APIs take. */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

/** A chat-completions function tool (llmTools, decisionLlmTools). */
export interface LlmTool {
  type: 'function';
  function: { name: string; description: string; parameters: JsonSchema };
}

// ---------------------------------------------------------------- state

/** A panel in the state snapshot (schema.ts panelSnapshot); coordinates rounded to 0.01. */
export interface PanelSnapshot {
  id: string;
  name: string;
  page: number;
  tool: ToolKind;
  ready: boolean;
  problem: string | null;
  grid: {
    corners: Point[];
    anchor?: 'centers';
    shape?: 'circle';
    rows: number;
    cols: number;
    sizeSource: 'detected' | 'set';
    sampleFraction: number;
    rowLabels: string[];
    colLabels: string[];
    boxLabels?: string[];
  } | null;
  colorbar: {
    start: Point | null;
    end: Point | null;
    halfWidth: number;
    scale: ColorbarScale;
    colormap: ColormapRef | null;
    ticks: { id?: string; t: number | null; value: number | null }[];
  };
  settings: PanelSettings;
  review: { status: string; by: string | null; confidence: number | null; note: string | null } | null;
  map?: { bin: number; xTicks: number; yTicks: number; profiles: { id: string; name: string }[] };
  regions?: { id: string; name: string; shape: string; replicate: boolean; nudged: number }[];
  scaleBar?: { p1: Point | null; p2: Point | null; length: number; unit: string } | null;
}

/** stateSnapshot(): plain JSON view of the workspace for agents. */
export interface StateSnapshot {
  schema: string;
  version: number;
  tool: ToolKind;
  mode: { type: string; points: (Point | null)[] } | null;
  source: { fileName: string; page: number; pageCount: number; width: number; height: number; dpi: number } | null;
  activePanelId: string | null;
  panels: PanelSnapshot[];
  history: { canUndo: boolean; canRedo: boolean };
  openQuestions: number;
}

/**
 * A panel's results as agent JSON (heatmapResultJson, roiResultJson,
 * mapResultJson), or {panelId, error}. Read loosely: the tool decides the fields.
 */
export type ResultJson = { panelId: string; error?: string; tool?: ToolKind } & Record<string, unknown>;

// ---------------------------------------------------------------- questions and decisions

export type QuestionType =
  | 'confirm_grid_size'
  | 'classify_flagged'
  | 'classify_flagged_cells'
  | 'confirm_tick_order'
  | 'confirm_extraction';

/** A typed question (openQuestions). Its id is stable while its evidence is unchanged. */
export interface Question {
  id: string;
  type: QuestionType;
  panelId: string;
  prompt: string;
  evidence: Record<string, unknown>;
  answerSchema: JsonSchema;
  suggested?: Record<string, unknown>;
  /** confirm_extraction: the values the answer judges. */
  resultHash?: string;
  /** The last answer that was below the policy confidence. */
  escalated?: { answer: unknown; confidence: number | null; source: string };
}

/** A logged answer or review (api.ts `decisions`, saved as agent/decisions.json). */
export interface Decision {
  questionId: string | null;
  type: QuestionType | 'set_review';
  panelId: string;
  evidence: Record<string, unknown>;
  answer: unknown;
  note?: string;
  confidence: number | null;
  source: string;
  model: string | null;
  applied: boolean;
  time: string;
}

/** A logged mutating action (agent/actions.json). */
export interface ActionLogEntry {
  action: string;
  args: ActionArgs;
  ok: boolean;
  error?: string;
  time: string;
}

/** Answers below minConfidence are logged but not applied; humanSources always apply. */
export interface AgentPolicy {
  minConfidence: number;
  humanSources: string[];
}

// ---------------------------------------------------------------- window.colormeris

/** What api.run returns. It never throws; mutating actions also return the new state. */
export type ActionResult =
  | { ok: true; result: unknown; notes?: string[]; state?: StateSnapshot }
  | { ok: false; error: string };

/** One step of api.batch. */
export interface BatchAction {
  name: string;
  args?: ActionArgs;
}

/** The typed agent API (createAgentApi), exposed as window.colormeris. */
export interface ColormerisApi {
  version: number;
  run: (name: string, args?: ActionArgs) => Promise<ActionResult>;
  /** Runs in order and stops at the first failure. */
  batch: (actions: BatchAction[]) => Promise<(ActionResult & { name: string })[]>;
  tools: () => ToolDefinition[];
  policy: AgentPolicy;
  log: () => { actions: ActionLogEntry[]; decisions: Decision[] };
}

// ---------------------------------------------------------------- LLM chat (OpenRouter SDK, camelCase)

/** A content part of a chat message as the SDK takes it. */
export type ChatContentPart = { type: 'text'; text: string } | { type: 'image_url'; imageUrl: { url: string } };

/** A tool call in an assistant message; arguments is a JSON string. */
export interface ToolCall {
  id: string;
  type?: 'function';
  function: { name: string; arguments: string };
}

/** A message of the run's conversation. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

/** Token and cost counts of a chat response. */
export interface ChatUsage {
  cost?: number;
  promptTokens?: number;
  completionTokens?: number;
  promptTokensDetails?: { cachedTokens?: number; cacheWriteTokens?: number };
}

export interface ChatResponse {
  choices?: { message?: { content?: unknown; toolCalls?: ToolCall[] } }[];
  usage?: ChatUsage;
}

/** The request the runner sends (chat.send({chatRequest})). */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: LlmTool[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
  cacheControl?: { type: 'ephemeral'; ttl?: string };
  sessionId?: string;
}

/**
 * The slice of the OpenRouter SDK client the app uses (makeOpenRouterClient).
 * Tests and the browser tips in CLAUDE.md pass mocks of this shape.
 */
export interface ChatClient {
  chat: { send: (req: { chatRequest: ChatRequest }, opts?: { signal?: AbortSignal }) => Promise<ChatResponse> };
}

// ---------------------------------------------------------------- runner

/** Where a rendered view sits on the page: page = x0 + image / scale. */
export interface ViewFrame {
  x0: number;
  y0: number;
  scale: number;
  width: number;
  height: number;
}

/** An image for a model (runner.ts renderView, renderOverview). `note` explains its coordinates. */
export interface RenderedView {
  dataUrl: string;
  note?: string;
  region?: { x0: number; y0: number; scale: number };
  frame?: ViewFrame;
}

/** A tool's result inside the runner (runner tools, decision tools) before it becomes text. */
export interface ToolCallResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  image?: RenderedView;
  images?: RenderedView[];
  /** finish refused (finishCheck). */
  finished?: boolean;
  [key: string]: unknown;
}

/** Running totals of a run, sent with every event. */
export interface RunUsage {
  llmCost: number;
  promptTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  completionTokens: number;
  steps: number;
  decisions: number;
  decisionCost: number;
}

/** Events of a run for the Agent card's log. */
export type RunEventType = 'thinking' | 'assistant' | 'tool' | 'result' | 'tool-error' | 'done';

/** Event data: what the event carries plus the usage so far. */
export type RunEventData = Record<string, unknown> & { usage: RunUsage };

/** runner.run settings. `focus` asks the agent to redo one rejected panel. */
export interface RunSettings {
  client: ChatClient;
  llmModel: string;
  pages: number[];
  maxSteps?: number;
  signal?: AbortSignal;
  onEvent?: (type: RunEventType, data: RunEventData) => void;
  focus?: { panelId: string; note?: string } | null;
  systemPrompt?: string;
  mode?: 'agent' | 'decision';
  decide?: DecideFn;
  decisionModel?: string;
}

export interface RunOutcome {
  summary: string;
  usage: RunUsage;
}

/** Per-tool, per-panel retry limits (createRetryGuard). */
export interface RetryGuard {
  /** Why the run must stop, or null. */
  stop: string | null;
  /** An error result when the tool is blocked for the panel, else null. */
  before: (name: string, panelId: string | undefined) => ToolCallResult | null;
  after: (name: string, panelId: string | undefined, result: ToolCallResult) => ToolCallResult;
}

/** A heatmap panel as finishCheck and progressNote see it. */
export interface RunPanel {
  id: string;
  name: string;
  page: number;
  ready: boolean;
  /** Has a grid, colorbar or labels. */
  started: boolean;
}

// ---------------------------------------------------------------- decision model (Jev)

/** A question to the decision model; criteria depend on the type. */
export interface DecisionQuestion {
  type: 'noul' | 'choice' | 'score' | 'box';
  instructions: string;
  criteria?: Record<string, string> | string[];
}

/** An image part of a Decisions API state (snake_case, unlike the SDK). */
export interface DecisionImagePart {
  type: 'image_url';
  image_url: { url: string };
}

/** Body of POST /api/alpha/decisions. */
export interface DecisionRequest {
  model?: string;
  state: DecisionImagePart[];
  questions: Record<string, DecisionQuestion>;
}

/** A box answer: edges as 0–1 of the image (boxToPage maps it to the page). */
export interface DecisionBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One answer; which fields are set depends on the question type. */
export interface DecisionAnswer {
  box?: DecisionBox;
  noul?: unknown;
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  [key: string]: unknown;
}

export interface DecisionResponse {
  answers: Record<string, DecisionAnswer>;
  usage?: { cost?: number };
}

/** makeDecisionClient(): posts one request, retrying once on a 5xx or network error. */
export type DecideFn = (body: DecisionRequest, opts?: { signal?: AbortSignal }) => Promise<DecisionResponse>;

/** createDecisionTools(): the decision-mode tools the runner hands calls to. */
export interface DecisionTools {
  /** Starts the decision-model requests of a turn's locate_heatmap calls at once. */
  prefetch: (calls: { name: string; args: ActionArgs | null }[]) => void;
  handles: (name: string) => boolean;
  call: (name: string, args: ActionArgs | null) => Promise<ToolCallResult>;
}

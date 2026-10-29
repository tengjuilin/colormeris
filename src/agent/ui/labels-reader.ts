import { notify } from '../../extract/workspace/store.ts';
import type { Corners, SettingsUi, Workspace } from '../../types/index.ts';
import { DEFAULT_LABELS_MODEL, LABELS_PROMPT, labelsTool, labelsUserText, parseLabelsAnswer } from '../labels.ts';
import { loadOpenRouterSdk, makeOpenRouterClient } from '../openrouter-client.ts';

// "Read labels with AI" in the Grid card (heatmap): sends the current view,
// with the grid outline drawn on it, to a vision LLM and fills in the active
// panel's row and column labels in one undoable step. Uses the Agent's key
// and base URL; the model is the Model field next to the button (agent.labels).
// No DOM here: the Grid card (React) calls readLabels() and reads labelsReaderState()
// during render; every change of the state notifies the workspace bridge.

const MAX_SIDE = 1568; // longest side sent; larger images are downscaled by the providers anyway

/** What the button and the hint under it show. */
export interface LabelsReaderState {
  busy: boolean;
  hint: string;
  error: boolean;
}

let state: LabelsReaderState = { busy: false, hint: '', error: false };
let deps: { ws: Workspace; settingsUi: SettingsUi } | null = null;
let onModelFocus: (() => void) | null = null;

export const labelsReaderState = () => state;

function update(patch: Partial<LabelsReaderState>) {
  state = { ...state, ...patch };
  notify({ light: true });
}

const setHint = (hint: string, error = false) => update({ hint, error });

/** Give the reader the workspace and the settings; called once at startup. */
export function setupLabelReader(ws: Workspace, settingsUi: SettingsUi) {
  deps = { ws, settingsUi };
}

/** The Agent card registers what happens when the Model field gets focus (it loads the model lists). */
export function setLabelsModelFocusHandler(fn: () => void) {
  onModelFocus = fn;
}
export const labelsModelFocused = () => onModelFocus?.();

/** Save the model typed in the Model field (agent.labels). */
export function setLabelsModel(value: string) {
  if (!deps) return;
  deps.settingsUi.get().agent.labels = value.trim();
  deps.settingsUi.save();
  // Render now, so the field's resync after this commit reads the saved model, not the old one.
  notify();
}

// The view canvas as a JPEG, and the grid's box in that image's pixels.
function viewImage({ viewer }: Workspace, corners: Corners) {
  // Draw now: a pending requestDraw (paused in hidden tabs) may not have run yet.
  viewer.draw();
  const src = viewer.canvas;
  const k = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(src.width * k));
  out.height = Math.max(1, Math.round(src.height * k));
  out.getContext('2d')!.drawImage(src, 0, 0, out.width, out.height);
  const f = (window.devicePixelRatio || 1) * k;
  const pts = corners.map((c) => viewer.toScreen(c)).map((p) => ({ x: p.x * f, y: p.y * f }));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  return { dataUrl: out.toDataURL('image/jpeg', 0.9), box };
}

/** Read the labels of the active panel's grid with the vision model and apply them (one undo step). */
export async function readLabels() {
  if (!deps || state.busy) return;
  const { ws, settingsUi } = deps;
  const agent = () => settingsUi.get().agent;
  const panel = ws.activePanel();
  if (!panel?.grid.corners) return;
  const { key, base, labels } = agent();
  if (!key && !base) {
    setHint('Set an OpenRouter key or proxy URL in Settings → Agent first.', true);
    settingsUi.open('agent');
    return;
  }
  const panelId = panel.id;
  const { rows, cols } = panel.grid;
  const model = labels || DEFAULT_LABELS_MODEL;
  const { dataUrl, box } = viewImage(ws, panel.grid.corners);
  update({ busy: true, hint: `Asking ${model}…`, error: false });
  try {
    const client = makeOpenRouterClient(await loadOpenRouterSdk(), { key, base });
    const res = await client.chat.send({
      chatRequest: {
        model,
        messages: [
          { role: 'system', content: agent().labelsPrompt || LABELS_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: labelsUserText({ rows, cols, box }) },
              { type: 'image_url', imageUrl: { url: dataUrl } },
            ],
          },
        ],
        tools: [labelsTool()],
        toolChoice: { type: 'function', function: { name: 'set_labels' } },
        maxTokens: 1024,
        temperature: 0,
      },
    });
    const out = parseLabelsAnswer(res.choices?.[0]?.message, { rows, cols });
    // The user may have switched panels while waiting; never write into another one.
    if (ws.activePanel()?.id !== panelId) {
      setHint('Labels not applied: the panel changed while reading.', true);
      return;
    }
    if (!out.rowLabels.length && !out.colLabels.length) {
      setHint(`No labels found.${out.note ? ` ${out.note}` : ''}`, true);
      return;
    }
    ws.commit((p) => {
      if (out.rowLabels.length) p.grid.rowLabels = out.rowLabels;
      if (out.colLabels.length) p.grid.colLabels = out.colLabels;
    });
    const cost = res.usage?.cost ? ` ($${res.usage.cost.toFixed(4)})` : '';
    const parts = [
      `Read ${out.rowLabels.length} row and ${out.colLabels.length} column labels${cost}. Check them; Undo reverts.`,
    ];
    if (out.warnings.length) parts.push(`Note: ${out.warnings.join('; ')}.`);
    if (out.note) parts.push(out.note);
    setHint(parts.join(' '), out.warnings.length > 0);
  } catch (err) {
    setHint(`Could not read labels: ${(err as Error)?.message || err}`, true);
  } finally {
    update({ busy: false });
  }
}

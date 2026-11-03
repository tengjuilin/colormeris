// Pure parts of the runner's chat loop (runner.ts runs it): parsing the
// model's tool calls once, adding up usage, and the texts and messages the
// LLM reads (opening, redo focus, nudge, tool results with images). The
// texts are tuned against real runs; keep them as they are.

import type {
  ActionArgs,
  ChatContentPart,
  ChatMessage,
  ChatUsage,
  PanelSnapshot,
  RenderedView,
  RunUsage,
  ToolCall,
  ToolCallResult,
} from '../types/index.ts';

export const newUsage = (): RunUsage => ({
  llmCost: 0,
  promptTokens: 0,
  cachedTokens: 0,
  cacheWriteTokens: 0,
  completionTokens: 0,
  steps: 0,
  decisions: 0,
  decisionCost: 0,
});

// Add one chat response's usage to the run's totals.
export function addUsage(usage: RunUsage, u: ChatUsage | undefined) {
  usage.llmCost += u?.cost || 0;
  usage.promptTokens += u?.promptTokens || 0;
  usage.cachedTokens += u?.promptTokensDetails?.cachedTokens || 0;
  usage.cacheWriteTokens += u?.promptTokensDetails?.cacheWriteTokens || 0;
  usage.completionTokens += u?.completionTokens || 0;
}

/** A tool call with its arguments parsed; `args` is null when they are not valid JSON. */
export interface ParsedCall {
  id: string;
  name: string;
  args: ActionArgs | null;
}

// The turn's tool calls with their JSON arguments parsed once (the
// decision tools' prefetch and the calls themselves both read them).
export function parseToolCalls(calls: ToolCall[]): ParsedCall[] {
  return calls.map((c) => {
    let args: ActionArgs | null;
    try {
      args = c.function.arguments ? JSON.parse(c.function.arguments) : {};
    } catch {
      args = null;
    }
    return { id: c.id, name: c.function.name, args };
  });
}

// The redo instructions for one rejected panel, or '' without one.
export function focusText(
  target: PanelSnapshot | null | undefined,
  note: string | undefined,
  decisionMode: boolean,
): string {
  if (!target) return '';
  const rejected = `\n\nThis is a redo. Panel "${target.name}" (id ${target.id}) was rejected${note ? ` with the note: "${note}"` : ''}.`;
  return decisionMode
    ? `${rejected} Do not add panels. locate_heatmap with panelId "${target.id}" and a description that singles it out, then set_ticks and set_labels, then finish.`
    : `${rejected} Its current calibration: ${JSON.stringify({ grid: target.grid, colorbar: target.colorbar })}. Do not add panels. select_panel it, find what is wrong (grid corners, grid size, colorbar ends, ticks or scale), fix it, check with overlays, then finish.`;
}

// The first user message's text: the file, the pages to process, the
// panels already there, the redo focus and the opening image's note.
export function openingText({
  source: s,
  pages,
  panels,
  focus,
  note,
}: {
  source: { fileName: string; pageCount: number; width: number; height: number };
  pages: number[];
  panels: PanelSnapshot[];
  focus: string;
  note: string | undefined;
}) {
  return `File: ${s.fileName} (${s.pageCount} page${s.pageCount === 1 ? '' : 's'}). Process page${pages.length === 1 ? '' : 's'} ${pages.join(', ')}. Page images are ${s.width} × ${s.height} px. Existing panels: ${JSON.stringify(panels.map((p) => ({ id: p.id, name: p.name, page: p.page, ready: p.ready, review: p.review?.status })))}.${focus}\n${note}`;
}

// What the runner says when the model answers without a tool call.
export const nudgeText = (progress: string) =>
  `Continue with the tools. ${progress} Call finish only when every heatmap on every page has its own calibrated panel.`;

// A tool result's images, and the result as text for the tool message: its
// own text (locate_heatmap) next to the image notes; the images follow in
// a user message (imagesMessage).
export function splitImages(result: ToolCallResult): { result: ToolCallResult; images: RenderedView[] } {
  const images = result.images || (result.image ? [result.image] : []);
  if (!images.length) return { result, images };
  return {
    images,
    result: {
      ok: true,
      result: [
        result.result,
        ...images.map((im) => im.note),
        images.length > 1 ? 'The images follow.' : 'The image follows.',
      ]
        .filter(Boolean)
        .join(' '),
    },
  };
}

// One user message with the turn's images, each after its note.
export function imagesMessage(images: RenderedView[]): ChatMessage {
  return {
    role: 'user',
    content: images.flatMap((im): ChatContentPart[] => [
      { type: 'text', text: im.note ?? '' },
      { type: 'image_url', imageUrl: { url: im.dataUrl } },
    ]),
  };
}

// Runs the extraction agent: an LLM (any OpenRouter chat model with vision
// and tools) drives the page through the typed agent API and looks at it
// through rendered page images with pixel rulers. `client` is an OpenRouter
// SDK client (or anything with chat.send).

import { rgbToHex } from '../core/color.ts';
import { colorAtT } from '../core/colorbar.ts';
import { bilinear, cellSamplePolygon, outerCorners } from '../core/grid.ts';
import { canvasDataUrl, renderPdfPage } from '../extract/pdf-loader.ts';
import { ticksWithT } from '../extract/project/project.ts';
import type {
  Box,
  ChatMessage,
  ChatRequest,
  ColormerisApi,
  HeatmapResult,
  Point,
  RenderedView,
  RunEventData,
  RunEventType,
  RunOutcome,
  RunSettings,
  StateSnapshot,
  ToolCallResult,
  Workspace,
} from '../types/index.ts';
import { DECISION_LLM_ACTIONS, DECISION_SYSTEM_PROMPT, decisionLlmTools, panelBrief } from './decide.ts';
import { createDecisionTools } from './decision-tools.ts';
import {
  AGENT_SYSTEM_PROMPT,
  createRetryGuard,
  finishCheck,
  LLM_ACTIONS,
  llmTools,
  panelStarted,
  progressNote,
  pruneImages,
  RUNNER_TOOLS,
  toolResultText,
  validateRunnerTool,
} from './llm.ts';
import {
  addUsage,
  focusText,
  imagesMessage,
  newUsage,
  nudgeText,
  openingText,
  parseToolCalls,
  splitImages,
} from './run-messages.ts';
import { labelPlace, markBoxes, niceStep, viewNote } from './runner-draw.ts';

const MAX_VIEW = 1024; // longest side of images sent to the LLM
// Prompt caching (openrouter.ai/docs/guides/best-practices/prompt-caching):
// a top-level cache_control makes Anthropic models cache everything up to
// the last block and move the breakpoint forward each step, and the other
// providers cache the shared prefix on their own. The system prompt, the
// tools and the old messages are identical from step to step. The 1-hour
// lifetime costs more per write than the 5-minute one but a run can pause
// for longer than 5 minutes (a slow model, a stalled tab).
const CACHE_CONTROL: ChatRequest['cacheControl'] = { type: 'ephemeral', ttl: '1h' };
// Rulers sit outside the picture on the right and bottom, so image pixel
// (0, 0) is exactly the top-left corner of the region shown. (With rulers on
// the left and top, models that measure from the image corner were off by
// the ruler width divided by the zoom.)
const RULER = { right: 50, bottom: 24 };

/** renderView's options: `region` and `marks` in page pixels; the rest as documented there. */
// TODO(types): tool arguments are validated against the tools' JSON Schema before use; typing each needs args types generated from the schema.
// biome-ignore lint/suspicious/noExplicitAny: see above
type Args = any;

/** What api.run returns, read loosely (result and state exist only on success). */
type RunResult = { ok: boolean; result?: unknown; error?: string; notes?: string[]; state?: StateSnapshot };

export interface RenderViewOptions {
  region?: Box | null;
  overlay?: string;
  maxSide?: number;
  rulers?: boolean;
  marks?: { box: Box; label: string; color?: string }[];
  minSide?: number;
  zoom?: boolean;
}

/** renderView: an image of the page or a region of it for a model. */
export type RenderViewFn = (opts?: RenderViewOptions) => Promise<RenderedView>;

type ToView = (p: Point) => Point;

export function createAgentRunner(ws: Workspace, api: ColormerisApi) {
  const { app } = ws;

  // ------------------------------------------------------------ images

  // Page (or region) image with rulers in page pixels and optional overlay.
  // `marks` are numbered boxes ({box, label}) drawn on top. Without rulers
  // (images for the decision model) the picture is padded with white to at
  // least `minSide` on each side and `frame` maps it back to the page.
  async function renderView({
    region,
    overlay = 'none',
    maxSide = MAX_VIEW,
    rulers = true,
    marks = [],
    minSide = 0,
    zoom = true,
  }: RenderViewOptions = {}): Promise<RenderedView> {
    const page = app.pages.get(ws.currentPage());
    if (!page) throw new Error('No page is shown.');
    const src = page.canvas;
    let { x0, y0, x1, y1 } = region || { x0: 0, y0: 0, x1: src.width, y1: src.height };
    [x0, x1] = [Math.max(0, Math.min(x0, x1)), Math.min(src.width, Math.max(x0, x1))];
    [y0, y1] = [Math.max(0, Math.min(y0, y1)), Math.min(src.height, Math.max(y0, y1))];
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 4 || h < 4) throw new Error('Region is too small or outside the page.');
    const scale = Math.min(6, maxSide / Math.max(w, h));
    const W = Math.round(w * scale);
    const H = Math.round(h * scale);
    const out = document.createElement('canvas');
    out.width = rulers ? W + RULER.right : Math.max(W, minSide);
    out.height = rulers ? H + RULER.bottom : Math.max(H, minSide);
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(src, x0, y0, w, h, 0, 0, W, H);
    const toView: ToView = (p) => ({ x: (p.x - x0) * scale, y: (p.y - y0) * scale });

    if (overlay !== 'none') drawPanels(ctx, toView, overlay);
    drawMarks(ctx, toView, marks);
    const frame = { x0, y0, scale, width: out.width, height: out.height };
    if (!rulers) return { dataUrl: await canvasDataUrl(out, 'image/png'), frame };

    // Rulers (bottom and right) with faint guide lines across the picture.
    const step = niceStep(scale);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#000';
    ctx.strokeStyle = 'rgba(0, 170, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      const vx = Math.round(toView({ x, y: 0 }).x) + 0.5;
      ctx.beginPath();
      ctx.moveTo(vx, 0);
      ctx.lineTo(vx, H + 5);
      ctx.stroke();
      ctx.fillText(String(Math.round(x)), Math.min(Math.max(vx, 12), W - 12), H + 8);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const vy = Math.round(toView({ x: 0, y }).y) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, vy);
      ctx.lineTo(W + 5, vy);
      ctx.stroke();
      ctx.fillText(String(Math.round(y)), W + 8, Math.min(Math.max(vy, 7), H - 7));
    }
    if (zoom)
      ws.zoomToPoints([
        { x: x0, y: y0 },
        { x: x1, y: y1 },
      ]);
    return {
      dataUrl: await canvasDataUrl(out, 'image/jpeg', 0.9),
      note: viewNote({ page: ws.currentPage(), region: { x0, y0, x1, y1 }, scale, width: W, height: H }),
      region: { x0, y0, scale },
      frame,
    };
  }

  // Numbered boxes (tick-label candidates; `color` optional), numbers
  // outside the box where they cover no other box (labelPlace).
  function drawMarks(ctx: CanvasRenderingContext2D, toView: ToView, marks: NonNullable<RenderViewOptions['marks']>) {
    ctx.font = 'bold 16px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const boxes = markBoxes(
      marks.map((m) => m.box),
      toView,
    );
    const { width, height } = ctx.canvas;
    marks.forEach((m, i) => {
      const b = boxes[i];
      const color = m.color || '#1565ff';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      const tw = ctx.measureText(m.label).width + 8;
      const at = labelPlace(b, tw, boxes, width, height);
      ctx.fillStyle = color;
      ctx.fillRect(at.x0, at.y0, tw, 20);
      ctx.fillStyle = '#fff';
      ctx.fillText(m.label, at.x0 + 4, at.y0 + 11);
    });
  }

  function drawPanels(ctx: CanvasRenderingContext2D, toView: ToView, overlay: string) {
    const line = (a: Point, b: Point, color: string, width = 1.5) => {
      const p = toView(a);
      const q = toView(b);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    for (const panel of ws.pagePanels()) {
      const g = panel.grid;
      if (g.corners && overlay === 'reconstruction') {
        const res = ws.resultFor(panel) as HeatmapResult;
        if (res.cells) {
          for (let r = 0; r < g.rows; r++) {
            for (let c = 0; c < g.cols; c++) {
              // Empty and off-map cells have no value to repaint.
              if (res.cells[r][c].empty || res.cells[r][c].status === 'off-map') continue;
              const poly = cellSamplePolygon(g, r, c, res.cells[r][c].radius).map(toView);
              ctx.beginPath();
              poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
              ctx.closePath();
              ctx.fillStyle = rgbToHex(colorAtT(res.samples, res.cells[r][c].t));
              ctx.fill();
              if (res.cells[r][c].flagged) {
                ctx.strokeStyle = '#ff3b30';
                ctx.lineWidth = 2;
                ctx.stroke();
              }
            }
          }
        }
      }
      if (g.corners && overlay === 'calibration') {
        // Same grid as the workspace draws: through the dot centers for a dot plot.
        const dots = g.anchor === 'centers';
        const frame = dots ? g.corners : outerCorners(g);
        const nu = dots ? g.cols - 1 : g.cols;
        const nv = dots ? g.rows - 1 : g.rows;
        for (let c = 0; c <= nu; c++)
          line(bilinear(frame, c / nu, 0), bilinear(frame, c / nu, 1), '#e22bd0', c % nu ? 1 : 2);
        for (let r = 0; r <= nv; r++)
          line(bilinear(frame, 0, r / nv), bilinear(frame, 1, r / nv), '#e22bd0', r % nv ? 1 : 2);
      }
      const cb = panel.colorbar;
      if (cb.start && cb.end && overlay === 'calibration') {
        line(cb.start, cb.end, '#f29900', 2);
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (const k of ticksWithT(cb)) {
          const p = toView(k as Point);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
          ctx.fillStyle = '#f29900';
          ctx.fill();
          // A white halo keeps the value readable on a dark bar.
          ctx.lineWidth = 3;
          ctx.strokeStyle = '#fff';
          ctx.strokeText(`${k.value}`, p.x + 7, p.y);
          ctx.fillStyle = '#000';
          ctx.fillText(`${k.value}`, p.x + 7, p.y);
        }
      }
    }
  }

  async function renderOverview(from: number, to: number): Promise<RenderedView> {
    if (!app.pdfDoc) throw new Error('The file has one page; use view_page.');
    const n = app.pdfDoc.numPages;
    from = Math.max(1, from);
    to = Math.min(n, to, from + 11);
    if (to < from) throw new Error(`Pages run from 1 to ${n}.`);
    const thumbs: { p: number; canvas: HTMLCanvasElement }[] = [];
    for (let p = from; p <= to; p++) {
      const page = await app.pdfDoc.getPage(p);
      const vw = page.getViewport({ scale: 1 }).width;
      thumbs.push({ p, canvas: (await renderPdfPage(app.pdfDoc, p, 320 / vw)).canvas });
    }
    const cols = Math.min(4, thumbs.length);
    const cw = 330;
    const ch = Math.max(...thumbs.map((t) => t.canvas.height)) + 26;
    const out = document.createElement('canvas');
    out.width = cols * cw;
    out.height = Math.ceil(thumbs.length / cols) * ch;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#ddd';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.font = 'bold 16px sans-serif';
    thumbs.forEach((t, i) => {
      const x = (i % cols) * cw + 5;
      const y = Math.floor(i / cols) * ch;
      ctx.fillStyle = '#000';
      ctx.fillText(`Page ${t.p}`, x, y + 18);
      ctx.drawImage(t.canvas, x, y + 24);
    });
    return { dataUrl: await canvasDataUrl(out, 'image/jpeg', 0.85), note: `Pages ${from}–${to} of ${n}.` };
  }

  // ------------------------------------------------------------ run

  // settings: {client, llmModel, pages: [n], maxSteps, signal,
  // onEvent(type, data), focus, mode, decide, decisionModel}. `focus`
  // ({panelId, note}) asks the agent to fix one rejected panel. mode
  // "decision" gives the LLM the tools of agent/decide.ts, answered with
  // `decide` (agent/openrouter-client.ts) by `decisionModel`.
  async function run(settings: RunSettings): Promise<RunOutcome> {
    const {
      client,
      llmModel,
      pages,
      maxSteps = 60,
      signal,
      onEvent = () => {},
      focus,
      systemPrompt,
      mode = 'agent',
      decide,
      decisionModel,
    } = settings;
    const decisionMode = mode === 'decision';
    // One id for the whole run keeps the requests on the provider that
    // holds the cache (sticky routing).
    const sessionId = `colormeris-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const usage = newUsage();
    const emit = (type: RunEventType, data: object) => onEvent(type, { ...data, usage: { ...usage } } as RunEventData);
    const decision = decisionMode
      ? createDecisionTools(ws, api, { renderView, decide: decide!, model: decisionModel, usage, signal })
      : null;
    const llmActions = decisionMode ? DECISION_LLM_ACTIONS : LLM_ACTIONS;
    // What the model has looked at and built, so it cannot stop after the
    // first heatmap (see finishCheck).
    const viewedPages = new Set<number>();
    // Decision mode skips the final look at every page: the LLM lists the
    // heatmaps of a page before locating them, and the look costs an image.
    const finishState = { checked: decisionMode, refusals: 0 };
    const runPanels = () =>
      app.project.panels
        .filter((p) => p.tool === 'heatmap' && pages.includes(p.page))
        .map((p) => ({
          id: p.id,
          name: p.name,
          page: p.page,
          ready: !ws.resultFor(p).error,
          started: panelStarted(p),
        }));
    const progress = () => progressNote({ pages, viewedPages, panels: runPanels(), currentPage: ws.currentPage() });

    async function callTool(name: string, args: Args): Promise<ToolCallResult> {
      if (decision?.handles(name)) return decision.call(name, args);
      if (llmActions.includes(name)) {
        if (name === 'go_to_page' && !pages.includes(args.page))
          return { ok: false, error: `Page ${args.page} is not part of this run (pages ${pages.join(', ')}).` };
        const r: RunResult = await api.run(name, args);
        // In decision mode a new page comes with its image (one step less).
        if (decisionMode && name === 'go_to_page' && r.ok) {
          viewedPages.add(ws.currentPage());
          return { ok: true, result: `Page ${args.page} shown.`, image: await renderView() };
        }
        // Keep results small: the active panel instead of the full state
        // (in decision mode without its label lists).
        if (r.state) {
          const { state, ...rest } = r;
          const active = state.panels.find((p) => p.id === state.activePanelId);
          return { ...rest, activePanel: decisionMode ? panelBrief(active) : active, page: state.source?.page };
        }
        return r;
      }
      if (!RUNNER_TOOLS[name]) return { ok: false, error: `Unknown tool "${name}".` };
      const errs = validateRunnerTool(name, args);
      if (errs.length) return { ok: false, error: errs.join('; ') };
      if (name === 'view_page') {
        const image = await renderView(args);
        viewedPages.add(ws.currentPage());
        return { ok: true, image };
      }
      if (name === 'view_pages_overview') return { ok: true, image: await renderOverview(args.from, args.to) };
      if (name === 'finish' && !focus) {
        const why = finishCheck({ pages, viewedPages, panels: runPanels(), ...finishState });
        if (why) {
          finishState.refusals++;
          if (why.checklist) finishState.checked = true;
          emit('assistant', { text: `(finish refused) ${why.message}` });
          return { ok: true, finished: false, result: why.message };
        }
      }
      return { ok: true, result: null };
    }

    const s = app.project.source!;
    const first: RunResult = await api.run('go_to_page', { page: pages[0] });
    const panelsNow = (((await api.run('get_state')) as RunResult).result as StateSnapshot).panels;
    const target = focus && panelsNow.find((p) => p.id === focus.panelId);
    const focused = focusText(target, focus?.note, decisionMode);
    if (!first.ok) throw new Error(first.error);
    const opening =
      pages.length > 1 && app.pdfDoc
        ? await renderOverview(pages[0], pages[Math.min(pages.length, 12) - 1])
        : await renderView();
    if (!(pages.length > 1 && app.pdfDoc)) viewedPages.add(ws.currentPage());
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt || (decisionMode ? DECISION_SYSTEM_PROMPT : AGENT_SYSTEM_PROMPT) },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: openingText({ source: s, pages, panels: panelsNow, focus: focused, note: opening.note }),
          },
          { type: 'image_url', imageUrl: { url: opening.dataUrl } },
        ],
      },
    ];
    const tools = decisionMode ? decisionLlmTools() : llmTools();
    let nudges = 0;
    const guard = createRetryGuard();
    let summary: string | null = null;

    while (usage.steps < maxSteps && summary === null) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      usage.steps++;
      emit('thinking', { step: usage.steps });
      const res = await client.chat.send(
        {
          chatRequest: {
            model: llmModel,
            messages: pruneImages(messages),
            tools,
            toolChoice: 'auto',
            maxTokens: 4096,
            cacheControl: CACHE_CONTROL,
            sessionId,
          },
        },
        { signal },
      );
      const msg = res.choices?.[0]?.message;
      if (!msg) throw new Error('The model returned no message.');
      addUsage(usage, res.usage);
      messages.push({
        role: 'assistant',
        content: (msg.content ?? '') as string,
        ...(msg.toolCalls?.length ? { toolCalls: msg.toolCalls } : {}),
      });
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (text.trim()) emit('assistant', { text });
      if (!msg.toolCalls?.length) {
        if (++nudges > 2) break;
        messages.push({ role: 'user', content: nudgeText(progress()) });
        continue;
      }
      nudges = 0;
      const images: RenderedView[] = [];
      const calls = parseToolCalls(msg.toolCalls);
      // The decision model's boxes for this turn's locate_heatmap calls
      // are asked all at once; the calls themselves run in order below.
      decision?.prefetch(calls);
      for (const { id, name, args } of calls) {
        let result: ToolCallResult | null =
          args === null ? { ok: false, error: 'Arguments are not valid JSON.' } : null;
        // Retries are counted per tool and panel (the one named, else the active one).
        const panelKey = (args?.panelId as string | undefined) || ws.activePanel()?.id;
        if (!result) {
          emit('tool', { name, args });
          // A task boundary before each tool: its pixel work is synchronous,
          // and the card's clock and the log only update in between.
          await new Promise((resolve) => setTimeout(resolve, 0));
          result = guard.before(name, panelKey);
          if (!result) {
            try {
              result = await callTool(name, args);
            } catch (err) {
              if (signal?.aborted) throw err;
              result = { ok: false, error: (err as Error).message };
            }
          }
        }
        result = guard.after(name, panelKey, result);
        if (name === 'finish' && result.ok && result.finished !== false) summary = args!.summary as string;
        // Decision tools report what the decision model and the app found.
        if (result.ok && decision?.handles(name) && typeof result.result === 'string')
          emit('result', { name, text: result.result });
        const split = splitImages(result);
        images.push(...split.images);
        result = split.result;
        if (!result.ok) emit('tool-error', { name, error: result.error });
        messages.push({ role: 'tool', toolCallId: id, content: toolResultText(result) });
      }
      if (images.length) messages.push(imagesMessage(images));
      if (guard.stop) {
        emit('tool-error', { name: 'run', error: `Stopped: ${guard.stop}` });
        summary = `Stopped because ${guard.stop}.`;
      }
    }

    const out: RunOutcome = {
      summary:
        summary ??
        (usage.steps >= maxSteps ? `Stopped after ${maxSteps} steps.` : 'The model stopped without a summary.'),
      usage,
    };
    emit('done', out);
    return out;
  }

  return { run, renderView, renderOverview };
}

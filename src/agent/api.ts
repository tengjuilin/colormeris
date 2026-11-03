// Agent API: binds the typed actions of agent/schema.ts to a live workspace
// and exposes them as window.colormeris, so an LLM or a script can
// drive the page without clicking pixels:
//
//   await colormeris.run('set_grid', {topLeft: {x: 40, y: 60}, bottomRight: {x: 520, y: 400}})
//   → {ok: true, result, state}   or   {ok: false, error}
//
// Answers to typed questions carry a confidence. Below `policy.minConfidence`
// an answer is logged but not applied, and the question stays open for a
// human. Every mutating call and every decision is logged; both logs go into
// the project zip (agent/actions.json, agent/decisions.json).

import { rgbToLab } from '../core/color.ts';
import {
  labToT,
  makeValueFn,
  pointAtT,
  projectT,
  refineColorbar,
  sampleColorbar,
  snapTick,
  tickProblem,
} from '../core/colorbar.ts';
import { cellAt, detectGridSize, rectCorners } from '../core/grid.ts';
import { fileKind } from '../extract/pdf-loader.ts';
import { ANCHOR_DEFAULTS, boxLabel, createPanel, createRoi, ticksWithT } from '../extract/project/project.ts';
import { centroid, geomToBox } from '../extract/roi/geometry.ts';
import type {
  ActionArgs,
  ActionLogEntry,
  ActionResult,
  BatchAction,
  ColormerisApi,
  Decision,
  HeatmapResult,
  MapResult,
  Panel,
  PanelResult,
  Point,
  Question,
  QuestionType,
  ResultJson,
  RoiResult,
  RunOptions,
  Workspace,
} from '../types/index.ts';
import { averagePixel, colorbarNote, tickNote } from './action-notes.ts';
import { round } from './round.ts';
import {
  AGENT_ACTIONS,
  AGENT_SCHEMA,
  AGENT_VERSION,
  heatmapResultJson,
  mapResultJson,
  normalizeArgs,
  openQuestions,
  resultKeyHash,
  roiResultJson,
  stateSnapshot,
  toolDefinitions,
  validate,
  validateAction,
} from './schema.ts';

// TODO(types): handler arguments are checked against ACTIONS' JSON Schema in run(); typing each one needs args types generated from the schema.
// biome-ignore lint/suspicious/noExplicitAny: see above
type Args = any;

export function createAgentApi(ws: Workspace): ColormerisApi {
  const { app } = ws;
  const policy: ColormerisApi['policy'] = { minConfidence: 0.9, humanSources: ['human'] };
  const actionLog: ActionLogEntry[] = [];
  const decisions: Decision[] = [];

  const findPanel = (id: string) => app.project.panels.find((p) => p.id === id);
  // undefined while the page is not rendered; callers check what they need (cast: pure code takes a PixelImage).
  const imageOf = (panel: Panel) => app.pages.get(panel.page)?.imageData as ImageData;
  const needSource = () => {
    if (!app.sourceCanvas) throw new Error('No file is loaded. Use open_url first.');
  };

  // Make the panel active (switching tool and page as needed) and return it.
  async function takePanel(id?: string): Promise<Panel> {
    needSource();
    if (!id) return ws.activePanel();
    const panel = findPanel(id);
    if (!panel) throw new Error(`No panel "${id}".`);
    if (panel.tool !== ws.tool().kind) ws.setTool(panel.tool, { quiet: true });
    if (panel.page !== ws.currentPage()) await ws.goToPage(panel.page, { keepActive: true });
    app.project.activePanelId = panel.id;
    ws.changed();
    return panel;
  }

  const problems = () => Object.fromEntries(app.project.panels.map((p) => [p.id, ws.resultFor(p).error || null]));

  // A panel's result as agent JSON and the hash of its values, built once
  // per result: ws.resultFor returns the same object while the panel's
  // result key is unchanged, and state() asks for both after every action
  // (review status, questions). `sig` covers what the JSON reads of the
  // panel beyond its result (labels, maxDeltaE, scale, profile names),
  // which the result key leaves out. The cached JSON is never mutated.
  const resultMemo = new WeakMap<PanelResult, { sig: string; json: ResultJson; hash: string | null }>();
  function resultEntry(panel: Panel) {
    const res = ws.resultFor(panel);
    const sig = JSON.stringify([
      panel.id,
      panel.tool,
      panel.grid,
      panel.settings.maxDeltaE,
      panel.colorbar.scale,
      panel.tool === 'map' ? panel.map.profiles.map((l) => [l.id, l.name]) : null,
    ]);
    const hit = resultMemo.get(res);
    if (hit && hit.sig === sig) return hit;
    const json = toResultJson(panel, res);
    const entry = { sig, json, hash: json.error ? null : resultKeyHash(json as { values?: unknown }) };
    resultMemo.set(res, entry);
    return entry;
  }

  function toResultJson(panel: Panel, res: PanelResult): ResultJson {
    if (panel.tool === 'heatmap') return heatmapResultJson(panel, res as HeatmapResult) as ResultJson;
    if (panel.tool === 'map') return mapResultJson(panel, res as MapResult) as ResultJson;
    return roiResultJson(panel, res as RoiResult, (r, c) => boxLabel(panel.grid, r, c)) as ResultJson;
  }

  // Hash of the panel's current values, or null while it has no result.
  const currentHash = (panel: Panel) => resultEntry(panel).hash;

  // 'accepted' | 'rejected' while the values are unchanged since the
  // review, 'stale' after they changed, null when never reviewed.
  function reviewStatus(panel: Panel) {
    if (!panel.review) return null;
    return currentHash(panel) === panel.review.resultHash ? panel.review.status : 'stale';
  }

  function resultsJson(panel: Panel): ResultJson {
    const { json, hash } = resultEntry(panel);
    const out: ResultJson = { ...json };
    if (out.error) return out;
    if (panel.tool === 'heatmap') {
      const mine = decisions.filter((d) => d.applied && d.panelId === panel.id);
      out.excluded = [
        ...mine
          .filter((d) => d.type === 'classify_flagged' && d.answer === 'exclude')
          .map((d) => ({ row: d.evidence.row, col: d.evidence.col })),
        // Panel-wide exclusions apply to the values they were made on.
        ...mine
          .filter(
            (d) =>
              d.type === 'classify_flagged_cells' && d.answer === 'exclude_all' && d.questionId!.endsWith(`:${hash}`),
          )
          .flatMap((d) => d.evidence.cells as { row: number; col: number }[]),
      ];
    }
    out.review = panel.review
      ? {
          status: reviewStatus(panel),
          by: panel.review.by,
          confidence: panel.review.confidence,
          note: panel.review.note || null,
        }
      : null;
    return out;
  }

  function questions(panelId?: string): Question[] {
    // The typed questions cover heatmaps and ROI; maps have none yet.
    const panels = app.project.panels.filter((p) => p.tool !== 'map' && (!panelId || p.id === panelId));
    const results: Record<string, ResultJson> = {};
    const hashes: Record<string, string> = {};
    const detections: Record<string, ReturnType<typeof detectGridSize>> = {};
    for (const p of panels) {
      const img = imageOf(p);
      if (p.grid.corners && p.grid.autoSize && img) detections[p.id] = detectGridSize(img, p.grid.corners);
      const { hash } = resultEntry(p);
      if (hash === null) continue;
      results[p.id] = resultsJson(p);
      hashes[p.id] = hash;
    }
    return openQuestions({ panels, results, hashes, detections, decisions }).map((q) => {
      const last = [...decisions].reverse().find((d) => d.questionId === q.id);
      return last ? { ...q, escalated: { answer: last.answer, confidence: last.confidence, source: last.source } } : q;
    });
  }

  function state() {
    return stateSnapshot({
      project: app.project,
      tool: ws.tool().kind,
      mode: app.mode,
      activePanelId: app.sourceCanvas ? ws.activePanel().id : null,
      problems: problems() as Record<string, string>, // TODO(types): stateSnapshot takes string; null means no problem
      reviews: Object.fromEntries(
        app.project.panels.filter((p) => p.review).map((p) => [p.id, reviewStatus(p)]),
      ) as Record<string, string>,
      canUndo: ws.canUndo(),
      canRedo: ws.canRedo(),
      openQuestions: app.sourceCanvas ? questions().length : 0,
    });
  }

  // Size from detection (autoSize) or as given.
  function applyGridSize(panel: Panel, rows?: number, cols?: number) {
    if (rows && cols) {
      panel.grid.rows = rows;
      panel.grid.cols = cols;
      panel.grid.autoSize = false;
      return null;
    }
    const d = detectGridSize(imageOf(panel), panel.grid.corners!);
    panel.grid.rows = rows || d.rows;
    panel.grid.cols = cols || d.cols;
    panel.grid.autoSize = !rows && !cols;
    return d;
  }

  // What an applied answer changes, by question type. classify_flagged(_cells)
  // and confirm_tick_order are recorded decisions only; results report
  // excluded cells from the log.
  const applyAnswer: Partial<Record<QuestionType, (q: Question, answer: Args, d: Decision) => void>> = {
    confirm_grid_size: (_q, answer) => ws.commit((p) => applyGridSize(p, answer.rows, answer.cols)),
    confirm_extraction: (q, answer, d) =>
      ws.commit(
        (p) =>
          (p.review = {
            status: answer === 'accept' ? 'accepted' : 'rejected',
            by: d.source,
            confidence: d.confidence,
            note: '',
            resultHash: q.resultHash!,
            time: d.time,
          }),
      ),
  };

  const handlers: Record<string, (args: Args) => unknown> = {
    get_state: () => state(),
    get_results: async ({ panelId }) => resultsJson(await takePanel(panelId)),
    get_questions: ({ panelId }) => (needSource(), questions(panelId)),

    answer_question: async ({ questionId, answer, confidence = null, source = 'agent', model = null }) => {
      needSource();
      const q = questions().find((x) => x.id === questionId);
      if (!q)
        throw new Error(
          `No open question "${questionId}". Call get_questions again; questions change with the calibration.`,
        );
      const errs = validate(q.answerSchema, answer, 'answer');
      if (errs.length) throw new Error(errs.join('; '));
      const human = policy.humanSources.includes(source);
      const applied = human || (confidence !== null && confidence >= policy.minConfidence);
      const d = {
        questionId,
        type: q.type,
        panelId: q.panelId,
        evidence: q.evidence,
        answer,
        confidence,
        source,
        model,
        applied,
        time: new Date().toISOString(),
      };
      decisions.push(d);
      if (applied) {
        await takePanel(q.panelId);
        applyAnswer[q.type]?.(q, answer, d);
      } else
        ws.toast(
          `Needs review: ${q.prompt} (${source} ${confidence === null ? 'gave no confidence' : `was ${Math.round(confidence * 100)}% sure`})`,
        );
      return { applied, escalated: !applied };
    },

    sample_pixel: async ({ panelId, x, y, radius = 0 }) => {
      const panel = await takePanel(panelId);
      const img = imageOf(panel);
      const rgb = averagePixel(img, x, y, radius);
      const lab = rgbToLab(rgb);
      const out = { rgb, lab: lab.map((v) => round(v, 2)) };
      const cb = panel.colorbar;
      if (cb.start && cb.end) {
        const samples = sampleColorbar(img, cb.start, cb.end, cb.halfWidth, cb.nSamples);
        const { t, deltaE } = labToT(lab, samples, panel.settings.distance);
        Object.assign(out, { t, deltaE });
        const ticks = ticksWithT(cb);
        if (!tickProblem(ticks, cb.scale)) (out as Record<string, unknown>).value = makeValueFn(ticks, cb.scale)!(t);
      }
      return out;
    },

    focus: ({ points }) => {
      needSource();
      ws.zoomToPoints(points);
      return null;
    },

    open_url: async ({ url }) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not fetch ${url}: HTTP ${res.status}`);
      const blob = await res.blob();
      const u = new URL(url, location.href);
      let name = u.protocol === 'data:' ? 'download' : decodeURIComponent(u.pathname.split('/').pop() || 'download');
      // Blob and data URLs have no extension; take it from the MIME type.
      const ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'application/zip': 'zip' }[
        blob.type
      ];
      if (!/\.[a-z0-9]+$/i.test(name) && ext) name += `.${ext}`;
      const file = new File([blob], name, { type: blob.type });
      if (fileKind(file) === 'unknown') throw new Error(`Unsupported file type: ${name}`);
      await ws.openFile(file);
      if (!app.sourceCanvas) throw new Error(`Could not open ${name}.`);
      return null;
    },

    set_tool: ({ tool }) => {
      ws.setTool(tool);
      return null;
    },

    go_to_page: async ({ page }) => {
      needSource();
      if (page > app.project.source!.pageCount)
        throw new Error(`The file has ${app.project.source!.pageCount} page(s).`);
      await ws.goToPage(page);
      return null;
    },

    select_panel: async ({ panelId }) => (await takePanel(panelId), null),

    add_panel: ({ name }) => {
      needSource();
      const active = ws.activePanel();
      const panel = createPanel(name || `Panel ${app.project.panels.length + 1}`, ws.currentPage(), ws.tool().kind);
      panel.settings = { ...active.settings };
      ws.pushHistory();
      app.project.panels.push(panel);
      app.project.activePanelId = panel.id;
      ws.changed();
      return { panelId: panel.id };
    },

    rename_panel: async ({ panelId, name }) => {
      await takePanel(panelId);
      ws.commit((p) => (p.name = name));
      return null;
    },

    remove_panel: async ({ panelId }) => {
      needSource();
      const panel = findPanel(panelId);
      if (!panel) throw new Error(`No panel "${panelId}".`);
      return ws.removePanel(panel);
    },

    set_grid: async ({ panelId, topLeft, bottomRight, corners }) => {
      await takePanel(panelId);
      const cs = corners || rectCorners(topLeft, bottomRight);
      const w = Math.hypot(cs[1].x - cs[0].x, cs[1].y - cs[0].y);
      const h = Math.hypot(cs[3].x - cs[0].x, cs[3].y - cs[0].y);
      if (w < 2 || h < 2) throw new Error('Grid is too small.');
      let detected: ReturnType<typeof applyGridSize> = null;
      ws.commit((p) => {
        p.grid.corners = cs;
        // The agent places outer corners; a dot-plot panel goes back to that mode.
        if (p.grid.anchor !== 'corners') Object.assign(p.grid, { anchor: 'corners', ...ANCHOR_DEFAULTS.corners });
        // Always detect: the LLM's own count would skip the grid-size check.
        detected = applyGridSize(p);
      });
      return {
        detected: {
          rows: detected!.rows,
          cols: detected!.cols,
          rowConfidence: detected!.rowConfidence,
          colConfidence: detected!.colConfidence,
        },
      };
    },

    detect_grid_size: async ({ panelId }) => {
      const panel = await takePanel(panelId);
      if (!panel.grid.corners) throw new Error('Place the grid first (set_grid).');
      return detectGridSize(imageOf(panel), panel.grid.corners);
    },

    set_grid_size: async ({ panelId, rows, cols }) => {
      await takePanel(panelId);
      ws.commit((p) => applyGridSize(p, rows, cols));
      return null;
    },

    set_labels: async ({ panelId, rows, cols, boxes }) => {
      await takePanel(panelId);
      ws.commit((p) => {
        if (rows) p.grid.rowLabels = [...rows];
        if (cols) p.grid.colLabels = [...cols];
        if (boxes) p.grid.boxLabels = [...boxes];
      });
      return null;
    },

    remove_grid: async ({ panelId }) => {
      await takePanel(panelId);
      ws.commit((p) => (p.grid.corners = null));
      return null;
    },

    set_colorbar: async ({ panelId, start, end, halfWidth, snap = true }) => {
      const panel = await takePanel(panelId);
      if (Math.hypot(end.x - start.x, end.y - start.y) < 3) throw new Error('Colorbar is too short.');
      const fit = snap ? refineColorbar(imageOf(panel), start, end) : null;
      const s = fit ? fit.start : start;
      const e = fit ? fit.end : end;
      // A snapped halfWidth never reaches past the middle of the strip.
      const hw = fit ? Math.min(halfWidth ?? fit.halfWidth, fit.halfWidth) : halfWidth;
      ws.commit((p) => {
        const cb = p.colorbar;
        cb.start = { ...s };
        cb.end = { ...e };
        if (hw !== undefined) cb.halfWidth = hw;
        // Ticks mark printed labels, so they stay where they are on the page.
        for (const k of cb.ticks)
          Object.assign(k, pointAtT(cb.start!, cb.end!, projectT(cb.start!, cb.end!, k as Point)));
      });
      const note = colorbarNote({ snap, fit, given: { start, end }, placed: { start: s, end: e }, halfWidth: hw });
      return { start: s, end: e, halfWidth: panel.colorbar.halfWidth, note };
    },

    add_tick: async ({ panelId, t, at, value, snap = true }) => {
      const panel = await takePanel(panelId);
      const { start, end } = panel.colorbar;
      if (!start || !end) throw new Error('Place the colorbar first (set_colorbar).');
      let tt = at ? projectT(start, end, at) : t;
      if (tt < -0.1 || tt > 1.1) throw new Error(`That point is off the colorbar (t = ${tt.toFixed(2)}).`);
      const mark = snap ? snapTick(imageOf(panel), start, end, pointAtT(start, end, tt)) : null;
      if (mark) tt = mark.t;
      const id = ws.newTickId();
      ws.commit((p) => p.colorbar.ticks.push({ id, ...pointAtT(start, end, tt), value }));
      return { tickId: id, t: round(tt, 4), note: tickNote(snap, mark) };
    },

    set_tick_value: async ({ panelId, tickId, value }) => {
      const panel = await takePanel(panelId);
      if (!panel.colorbar.ticks.some((k) => k.id === tickId)) throw new Error(`No tick "${tickId}".`);
      ws.commit((p) => (p.colorbar.ticks.find((k) => k.id === tickId)!.value = value));
      return null;
    },

    remove_tick: async ({ panelId, tickId }) => {
      const panel = await takePanel(panelId);
      if (!panel.colorbar.ticks.some((k) => k.id === tickId)) throw new Error(`No tick "${tickId}".`);
      ws.commit((p) => (p.colorbar.ticks = p.colorbar.ticks.filter((k) => k.id !== tickId)));
      return null;
    },

    set_colorbar_scale: async ({ panelId, scale }) => {
      await takePanel(panelId);
      ws.commit((p) => (p.colorbar.scale = scale));
      return null;
    },

    set_settings: async ({ panelId, sampleFraction, ...settings }) => {
      await takePanel(panelId);
      ws.commit((p) => {
        Object.assign(p.settings, settings);
        if (sampleFraction !== undefined) p.grid.sampleFraction = sampleFraction;
      });
      return null;
    },

    add_region: async ({ panelId, shape, geom, name, replicate = true }) => {
      const panel = await takePanel(panelId);
      if (panel.tool !== 'roi') throw new Error('Regions belong to ROI panels; use set_tool first.');
      const px =
        shape === 'polygon'
          ? { points: geom.points.map((q: Point) => ({ x: q.x, y: q.y })) }
          : { cx: geom.cx, cy: geom.cy, rx: geom.rx, ry: geom.ry };
      const grid = panel.grid;
      const cell =
        replicate && grid.corners
          ? cellAt(grid, shape === 'polygon' ? centroid(px.points) : { x: px.cx, y: px.cy })
          : null;
      const label = name || `ROI ${panel.rois.length + 1}`;
      const roi = cell
        ? createRoi(shape, geomToBox(shape, px, grid, cell.row, cell.col), { name: label })
        : createRoi(shape, px, { name: label, replicate: false });
      ws.commit((p) => p.rois.push(roi));
      return { regionId: roi.id, replicated: !!cell };
    },

    remove_region: async ({ panelId, regionId }) => {
      const panel = await takePanel(panelId);
      if (!panel.rois.some((r) => r.id === regionId)) throw new Error(`No region "${regionId}".`);
      ws.commit((p) => (p.rois = p.rois.filter((r) => r.id !== regionId)));
      return null;
    },

    set_scale_bar: async ({ panelId, p1, p2, length, unit = 'cm' }) => {
      const panel = await takePanel(panelId);
      if (panel.tool !== 'roi') throw new Error('The scale bar belongs to ROI panels.');
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 3) throw new Error('Scale bar is too short.');
      ws.commit((p) => (p.scale = { p1: { ...p1 }, p2: { ...p2 }, length, unit }));
      return null;
    },

    set_review: async ({ panelId, status, note = '', source = 'agent' }) => {
      const panel = await takePanel(panelId);
      const hash = currentHash(panel);
      if (status && !hash) throw new Error(`Nothing to review yet: ${ws.resultFor(panel).error}`);
      const time = new Date().toISOString();
      ws.commit(
        (p) => (p.review = status ? { status, by: source, confidence: 1, note, resultHash: hash!, time } : null),
      );
      decisions.push({
        questionId: null,
        type: 'set_review',
        panelId: panel.id,
        evidence: { resultHash: hash },
        answer: status,
        note,
        confidence: 1,
        source,
        model: null,
        applied: true,
        time,
      });
      return { status };
    },

    undo: () => (ws.undo(), null),
    redo: () => (ws.redo(), null),
    export_project: async () => (needSource(), await ws.exportZip(), null),
  };

  // Run one action. Never throws; mutating actions also return the new state
  // (unless `state: false`: callers that only want the effect skip building it).
  async function run(name: string, rawArgs: ActionArgs = {}, opts: RunOptions = {}): Promise<ActionResult> {
    const { args, notes } = normalizeArgs(name, rawArgs);
    const errs = validateAction(name, args);
    if (errs.length) return { ok: false, error: errs.join('; ') };
    const spec = AGENT_ACTIONS[name];
    const extra = notes.length ? { notes } : {};
    try {
      if (spec.mutates && app.mode) ws.setMode(null);
      const result = await handlers[name](args);
      if (spec.mutates) actionLog.push({ action: name, args, ok: true, time: new Date().toISOString() });
      return spec.mutates && opts.state !== false
        ? { ok: true, result: result ?? null, ...extra, state: state() }
        : { ok: true, result: result ?? null, ...extra };
    } catch (err) {
      if (spec.mutates)
        actionLog.push({
          action: name,
          args,
          ok: false,
          error: (err as Error).message,
          time: new Date().toISOString(),
        });
      return { ok: false, error: (err as Error).message };
    }
  }

  // Run actions in order, stopping at the first failure.
  async function batch(actions: BatchAction[]) {
    const out: (ActionResult & { name: string })[] = [];
    for (const { name, args } of actions) {
      const r = await run(name, args);
      out.push({ name, ...r });
      if (!r.ok) break;
    }
    return out;
  }

  ws.zipExtras.push(() => [
    {
      path: 'agent/actions.json',
      content: JSON.stringify({ schema: AGENT_SCHEMA, version: AGENT_VERSION, actions: actionLog }, null, 2),
    },
    {
      path: 'agent/decisions.json',
      content: JSON.stringify({ schema: AGENT_SCHEMA, version: AGENT_VERSION, policy, decisions }, null, 2),
    },
  ]);

  return {
    version: AGENT_VERSION,
    run,
    batch,
    tools: toolDefinitions,
    policy,
    log: () => ({ actions: [...actionLog], decisions: [...decisions] }),
    reviewStatus,
  };
}

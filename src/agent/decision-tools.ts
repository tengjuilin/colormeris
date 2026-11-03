// Tools of "agent decision" mode (prompt, schemas and the pure choices in
// agent/decide.ts; image regions, sizes and texts in decide/views.ts). Each
// request to the decision model is about one heatmap and carries one
// image: the whole page, a crop around the heatmap, or the strip beside it.
//
//   createDecisionTools(ws, api, {renderView, decide, model, usage, signal})
//     → {handles(name), call(name, args), prefetch(calls)}
// `decide` posts a Decisions API body (agent/openrouter-client.ts).

import { projectT } from '../core/colorbar.ts';
import { findTickLabels, labelReach, snapEdges, snapStrip, snapStripBox } from '../core/locate.ts';
import { ticksWithT } from '../extract/project/project.ts';
import type {
  ActionArgs,
  Box,
  ColormerisApi,
  DecideFn,
  DecisionArgsMap,
  DecisionImagePart,
  DecisionQuestion,
  DecisionTools,
  HeatmapResult,
  Panel,
  Point,
  RenderedView,
  RunUsage,
  ToolCallResult,
  Workspace,
} from '../types/index.ts';
import {
  area,
  barLine,
  barSignature,
  besideBox,
  boxText,
  boxToPage,
  CANDIDATE_COLOR,
  candidateLines,
  checkSummary,
  chooseColorbar,
  cleanDecisionArgs,
  clipBox,
  cornersBox,
  countSignature,
  DECISION_TOOLS,
  decisionQuestions,
  gridSignature,
  iou,
  likelySides,
  orientation,
  overlaps,
  pageColorbars,
  panelMemo,
  planGrid,
  printedCheck,
  regions,
  regridOthers,
  scaleForBins,
  scaleForTicks,
  scaleNote,
  sideGap,
  snapCells,
  stripCandidate,
  tFromTopLeft,
  tickBoxesText,
  tickMisfit,
  VIEW,
  validateDecisionTool,
} from './decide.ts';
import { panelStarted } from './llm.ts';
import { round } from './round.ts';
import type { RenderViewFn } from './runner.ts';

/** A numbered tick-label box (findTickLabels' mark plus its label). */
interface Mark {
  at: Point;
  box: Box;
  note?: string;
  label: string;
}

/** Lettered colorbar candidates of chooseColorbar. */
type CandidateList = { letter: string; bar: Box; side: string; gap: number; labels: number }[];

/** chooseColorbar's result read loosely: `bar` and `how` when one strip wins, else `list`. */
interface Choice {
  bar?: Box;
  how?: string;
  list: CandidateList;
}

type Handlers = { [K in keyof DecisionArgsMap]: (args: DecisionArgsMap[K]) => Promise<ToolCallResult> };

const { jev: JEV } = VIEW;
const imagePart = (url: string): DecisionImagePart => ({ type: 'image_url', image_url: { url } });

export function createDecisionTools(
  ws: Workspace,
  api: ColormerisApi,
  {
    renderView,
    decide,
    model,
    usage,
    signal,
  }: { renderView: RenderViewFn; decide: DecideFn; model?: string; usage: RunUsage; signal?: AbortSignal },
): DecisionTools {
  const { app } = ws;
  // Per panel: tick-label boxes numbered from 1, the lettered colorbar
  // candidates last shown, and the box before its grid was cut to the
  // counted cells (to put a white end row back). Each holds only while its
  // colorbar (marks) or grid (the rest) is unchanged (panelMemo): undo,
  // remove_panel or the LLM's own set_colorbar must not leave boxes of a
  // bar that is gone.
  const marksByPanel = panelMemo<Mark[]>(barSignature);
  const candidatesByPanel = panelMemo<CandidateList>(gridSignature);
  const trimmedByPanel = panelMemo<{ box: Box; alt: Partial<Record<'row' | 'col', number>> }>(gridSignature);
  // Per panel: axes whose count the app was unsure of (a later panel lined
  // up with it may settle them).
  const unsureByPanel = panelMemo<{ row?: boolean; col?: boolean } | undefined>(countSignature);

  const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function ask(state: DecisionImagePart[], questions: Record<string, DecisionQuestion>) {
    const res = await decide({ model, state, questions }, { signal });
    usage.decisions++;
    usage.decisionCost += res.usage?.cost || 0;
    return res.answers;
  }
  // One image of a page region and the questions about it.
  async function askRegion(
    region: Box | null,
    questions: Record<string, DecisionQuestion>,
    maxSide: number = JEV.cropSide,
  ) {
    const view = await renderView({ region, rulers: false, maxSide, minSide: JEV.minSide, zoom: false });
    return { answers: await ask([imagePart(view.dataUrl)], questions), frame: view.frame! };
  }

  const page = () => app.pages.get(ws.currentPage())!;
  const size = () => ({ W: page().canvas.width, H: page().canvas.height });
  const clip = (b: Box) => clipBox(b, size().W, size().H);
  const gridBox = (p: Panel) => cornersBox(p.grid.corners!);

  // An agent action run for its effect (no state snapshot); throws on failure.
  async function act(name: string, args: ActionArgs) {
    const r = await api.run(name, args, { state: false });
    if (!r.ok) throw new Error(r.error);
    return r.result;
  }
  const clearTicks = async (panel: Panel) => {
    for (const k of [...panel.colorbar.ticks]) await act('remove_tick', { panelId: panel.id, tickId: k.id });
  };
  const setGridBox = (panel: Panel, b: Box) =>
    act('set_grid', { panelId: panel.id, topLeft: { x: b.x0, y: b.y0 }, bottomRight: { x: b.x1, y: b.y1 } });

  // Cell boxes of every gridded panel on this page (the cells are no
  // colorbar and hold no tick labels).
  const cellBoxes = (extra: Box[] = []) => [
    ...ws
      .pagePanels()
      .filter((p) => p.tool === 'heatmap' && p.grid.corners)
      .map(gridBox),
    ...extra,
  ];

  // Gridded heatmap panels of this page for planGrid.
  const pageGrids = () =>
    ws
      .pagePanels()
      .filter((p) => p.tool === 'heatmap' && p.grid.corners)
      .map((p) => ({
        id: p.id,
        name: p.name,
        cells: gridBox(p),
        rows: p.grid.rows,
        cols: p.grid.cols,
        unsure: unsureByPanel.get(p),
      }));

  // A named panel made active (switching page if needed), or the active one.
  async function takePanel(panelId?: string) {
    if (panelId) await act('select_panel', { panelId });
    const panel = panelId ? app.project.panels.find((p) => p.id === panelId) : ws.activePanel();
    if (!panel) throw new Error(`No panel "${panelId}".`);
    return panel;
  }

  // The panel to calibrate: the one named, the active one while it is
  // still empty, or a new one.
  async function targetPanel(name: string, panelId?: string) {
    if (panelId) await act('select_panel', { panelId });
    else {
      const active = ws.activePanel();
      if (!active || active.page !== ws.currentPage() || panelStarted(active)) await act('add_panel', { name });
    }
    const panel = ws.activePanel();
    if (panel.name !== name) await act('rename_panel', { panelId: panel.id, name });
    return panel;
  }

  // ------------------------------------------------------------ cells

  // The decision model's two boxes for a heatmap: roughly where on the
  // whole page, then the cells on a crop around that. They read only the
  // page image, so the locate_heatmap calls of one turn ask them all at
  // once (prefetch); the rest of each call (panels, grid, colorbar)
  // changes the workspace and runs in order.
  const pendingBoxes = new Map<string, ReturnType<typeof jevBoxes>>();
  const boxesKey = (description: string) => `${ws.currentPage()}\u0000${description}`;
  function jevBoxes(description: string) {
    const { W, H } = size();
    return (async () => {
      const found = await askRegion(null, decisionQuestions.find(description), JEV.pageSide);
      const rough = boxToPage(found.answers.cells.box!, found.frame);
      const crop = await askRegion(regions.crop(rough, W, H), decisionQuestions.cells());
      return {
        present: found.answers.present?.noul as number | undefined,
        rough,
        boxed: boxToPage(crop.answers.cells.box!, crop.frame),
      };
    })();
  }
  // `calls`: [{name, args}] of one LLM turn. Only locates on the page shown
  // (no page change in the turn, no panelId or box), two or more.
  function prefetch(calls: { name: string; args: ActionArgs | null }[]) {
    // Boxes asked for an earlier turn whose locate never ran (it failed
    // first, or the LLM changed its mind) are not reused.
    pendingBoxes.clear();
    if (calls.some((c) => c.name === 'go_to_page' || c.name === 'select_panel')) return;
    const locates = calls.filter(
      (c) =>
        c.name === 'locate_heatmap' &&
        c.args &&
        !c.args.box &&
        !c.args.panelId &&
        typeof c.args.description === 'string' &&
        c.args.description.length >= 3,
    );
    if (locates.length < 2) return;
    for (const c of locates) {
      const description = c.args!.description as string;
      const key = boxesKey(description);
      if (pendingBoxes.has(key)) continue;
      const p = jevBoxes(description);
      p.catch(() => {}); // reported when its locate awaits it
      pendingBoxes.set(key, p);
    }
  }

  // The cells from the decision model's boxes, snapped to pixels.
  async function cellsFromJev(description: string, notes: string[]) {
    const img = page().imageData;
    const key = boxesKey(description);
    const pending = pendingBoxes.get(key);
    pendingBoxes.delete(key);
    const { present, rough, boxed } = await (pending || jevBoxes(description));
    let { cells, partial, edges } = snapCells(img, rough, boxed);
    if (edges)
      notes.push(
        "The block snap stopped short of the decision model's box (pale cells?), so the grid is that box with its edges moved onto the cells: check the outer lines.",
      );
    if (partial)
      notes.push(
        `The snapped cells cover only ${Math.round((100 * area(cells!)) / area(rough))}% of where the decision model put the heatmap: if the grid holds only part of it, use correct_grid_size with box (its rough extent from the page rulers).`,
      );
    if (!cells) {
      cells = boxed;
      notes.push(
        "The cells could not be snapped to a block of color; the grid follows the decision model's box and may be off.",
      );
    }
    if (Number.isFinite(present) && present! < 0.5)
      notes.push(
        `The decision model doubts this heatmap matches the description (${round(present!, 1)}): check the image.`,
      );
    return { cells, rough: partial ? rough : null };
  }

  // Places the grid on `box` and settles rows and columns (planGrid in
  // agent/decide.ts): the app counts them from the cell borders, or takes
  // them from a panel lined up with this one, and cuts the corners to the
  // counted cells when they include something else. Earlier panels whose
  // count was unsure take this one's when they line up with it.
  async function placeGrid(panel: Panel, box: Box) {
    const others = pageGrids().filter((g) => g.id !== panel.id);
    const plan = planGrid(page().imageData, box, others);
    await setGridBox(panel, plan.cells);
    trimmedByPanel.delete(panel);
    if (plan.cells !== box) trimmedByPanel.set(panel, { box, alt: plan.alt });
    if (panel.grid.rows !== plan.rows || panel.grid.cols !== plan.cols)
      await act('set_grid_size', { panelId: panel.id, rows: plan.rows, cols: plan.cols });
    unsureByPanel.set(panel, plan.unsure);
    const notes = [...plan.notes];
    for (const u of regridOthers(
      { id: panel.id, name: panel.name, cells: plan.cells, rows: plan.rows, cols: plan.cols, unsure: plan.unsure },
      others,
    )) {
      await act('set_grid_size', { panelId: u.id, rows: u.rows, cols: u.cols });
      const other = app.project.panels.find((p) => p.id === u.id);
      if (other) unsureByPanel.set(other, { row: false, col: false });
      notes.push(u.note);
    }
    return { cells: plan.cells, rows: plan.rows, cols: plan.cols, note: notes.join(' ') };
  }

  // locate_heatmap, step 1: the panel's cells (the LLM's box, else the
  // decision model's), its grid and counts. The LLM's own box (after the
  // decision model found the wrong heatmap) is trusted: its edges only
  // move onto the cells' edges, and the decision model is not asked (a
  // bad crop answer overrode a good box before).
  async function locateCells(panel: Panel, description: string, box: Box | undefined, notes: string[]) {
    const located = box
      ? { cells: snapEdges(page().imageData, clip(box)) || clip(box), rough: null }
      : await cellsFromJev(description, notes);
    // Task boundaries between the pixel-heavy steps (snap, count, colorbars)
    // so the Agent card's clock keeps ticking.
    await breathe();
    const placed = await placeGrid(panel, located.cells);
    if (placed.note) notes.push(placed.note);
    // The decision model can put two descriptions on one heatmap (t10:
    // the strip above a block was boxed as the block).
    const twin = pageGrids().find((g) => g.id !== panel.id && iou(g.cells, placed.cells) > VIEW.twinIou);
    if (twin)
      notes.push(
        `These cells are the same as panel ${twin.id} "${twin.name}"'s: one of the two found the wrong heatmap; locate it again with panelId and box.`,
      );
    return { ...placed, rough: located.rough };
  }

  // ------------------------------------------------------------ colorbar

  // Puts the colorbar on `strip` (replacing the panel's ticks) and numbers
  // its tick-label boxes. A label just past a pale end extends the strip
  // to it (findTickLabels).
  async function applyBar(panel: Panel, strip: Box) {
    await clearTicks(panel);
    const found = findTickLabels(page().imageData, strip, { exclude: cellBoxes() });
    const bar = found.bar || strip;
    await act('set_colorbar', { panelId: panel.id, ...barLine(strip) });
    // The snap would cut the pale end off again.
    if (found.bar)
      await act('set_colorbar', {
        panelId: panel.id,
        ...barLine(bar),
        halfWidth: panel.colorbar.halfWidth,
        snap: false,
      });
    const marks = found.marks.map((m, i) => ({ ...m, label: String(i + 1) }));
    marksByPanel.set(panel, marks);
    candidatesByPanel.delete(panel);
    return { bar, marks, text: tickBoxesText(marks, { extended: !!found.bar }) };
  }

  // Colorbar candidates for cells: the strip at the decision model's box
  // beside them (on its two likeliest sides) and every colorbar found on
  // the page (findColorbars; categorical group strips left out), each with
  // its tick labels.
  async function colorbarCandidates(cells: Box, grid: { rows: number; cols: number }) {
    const img = page().imageData;
    const { W, H } = size();
    const exclude = cellBoxes([cells]);
    const { candidates: out, groups } = pageColorbars(img, exclude);
    // One strip right beside the cells needs no question.
    if ((chooseColorbar(cells, out, grid) as Choice).how === 'beside') return { candidates: out, none: null };
    const side = (await askRegion(regions.side(cells, W, H), decisionQuestions.side())).answers.side;
    // The decision model's box finds what the pixels miss (a gray colormap).
    if (side.choice !== 'none') {
      for (const s of likelySides(side)) {
        const strip = besideBox(cells, s, W, H);
        if (strip.x1 - strip.x0 < 4 || strip.y1 - strip.y0 < 4) continue;
        const b = await askRegion(strip, decisionQuestions.bar());
        const c = stripCandidate(img, snapStrip(img, boxToPage(b.answers.bar.box!, b.frame)), exclude, groups);
        if (c && !out.some((o) => overlaps(o.bar, c.bar))) out.push(c);
      }
    }
    return {
      candidates: out,
      none: side.choice === 'none' ? round(side.probabilities?.none ?? side.confidence!, 1) : null,
    };
  }

  // locate_heatmap, step 2: the colorbar beside the cells, else the
  // candidates for the LLM to choose from, else a note that none was found.
  async function pickColorbar(
    panel: Panel,
    name: string,
    cells: Box,
    grid: { rows: number; cols: number },
    notes: string[],
    images: RenderedView[],
  ) {
    const { candidates, none } = await colorbarCandidates(cells, grid);
    const choice = chooseColorbar(cells, candidates, grid) as Choice;
    if (choice.bar) {
      await breathe();
      const applied = await applyBar(panel, choice.bar);
      const gap = Math.round(sideGap(cells, applied.bar));
      if (choice.how === 'near') notes.push(`The colorbar is ${gap} px from the cells.`);
      if (choice.how === 'only')
        notes.push(
          `This is the only colorbar found on the page, ${gap} px from the cells: if it is not this heatmap's, use_colorbar with fromPanel or box.`,
        );
      return { bar: applied.bar as Box | null, marks: applied.marks, boxesText: applied.text, how: choice.how };
    }
    if (choice.list.length) {
      candidatesByPanel.set(panel, choice.list);
      marksByPanel.delete(panel);
      notes.push(
        `It is not clear which colorbar is this heatmap's. Candidates: ${candidateLines(cells, choice.list).join('; ')}. Choose with use_colorbar {candidate}, or {fromPanel} if it shares a calibrated panel's colorbar.`,
      );
      images.push(await candidatesView(choice.list, name));
    } else {
      marksByPanel.delete(panel);
      notes.push(
        `No colorbar was found${none !== null ? ` (the decision model sees none: ${none})` : ''}. If this heatmap has one, use_colorbar with box (its rough extent) or fromPanel; if it has none, remove_panel it.`,
      );
    }
    return { bar: null, marks: [] as Mark[], boxesText: '', how: undefined };
  }

  // ------------------------------------------------------------ images

  // The page with lettered colorbar candidates, rulers for rough boxes.
  async function candidatesView(list: CandidateList, name: string) {
    const view = await renderView({
      overlay: 'calibration',
      marks: list.map((c) => ({ box: c.bar, label: c.letter, color: CANDIDATE_COLOR })),
      zoom: false,
    });
    return {
      dataUrl: view.dataUrl,
      note: `${name}: colorbar candidates in orange letters, on the page with its rulers. ${view.note}`,
    };
  }

  // One image for the LLM: the cells with their own labels, colorbar and
  // numbered boxes (regions.panel). After a partial snap it also shows the
  // whole guessed area.
  async function panelView(cells: Box, extra: Box[], marks: Mark[]) {
    const img = page().imageData;
    const { W, H } = size();
    const region = regions.panel(
      cells,
      [...extra, ...marks.map((m) => m.box)],
      (side) => labelReach(img, cells, side, VIEW.reach),
      W,
      H,
    );
    const view = await renderView({
      region,
      overlay: 'calibration',
      rulers: false,
      maxSide: VIEW.maxSide.panel,
      marks,
    });
    ws.zoomToPoints([
      { x: region.x0, y: region.y0 },
      { x: region.x1, y: region.y1 },
    ]);
    return view;
  }

  // A colorbar with its numbered tick-label boxes, on its own.
  async function barView(panel: Panel, bar: Box, marks: Mark[]) {
    const { W, H } = size();
    const region = regions.bar(
      bar,
      marks.map((m) => m.box),
      W,
      H,
    );
    const view = await renderView({
      region,
      overlay: 'calibration',
      rulers: false,
      maxSide: VIEW.maxSide.bar,
      marks,
      zoom: false,
    });
    return {
      dataUrl: view.dataUrl,
      note: `Colorbar of ${panel.name} (panel ${panel.id}) with numbered tick-label boxes.`,
    };
  }

  // After set_ticks: the panel's grid and colorbar with the tick dots and
  // their values, so the LLM sees each dot level with its printed label
  // before finish (it rarely looked again by itself). Only the bar and its
  // labels when it lies far from the cells.
  async function ticksView(panel: Panel) {
    const { W, H } = size();
    const cb = panel.colorbar;
    const labels = (marksByPanel.get(panel) || []).map((m) => m.box);
    const { region, apart } = regions.ticks(gridBox(panel), cb.start!, cb.end!, labels, W, H);
    const view = await renderView({
      region,
      overlay: 'calibration',
      rulers: false,
      maxSide: VIEW.maxSide.ticks,
      zoom: false,
    });
    return {
      dataUrl: view.dataUrl,
      note: `${panel.name} (panel ${panel.id}) after set_ticks: orange dots are the ticks with their values; each should sit level with its printed label${apart ? '' : ', and the magenta grid on the cells'}.`,
    };
  }

  // locate_heatmap, step 3: the text and images for the LLM. A colorbar
  // away from the cells gets its own image; one image of both would shrink
  // the cells (test-1: 2600 px apart).
  async function locateResult(
    panel: Panel,
    name: string,
    placed: { cells: Box; rows: number; cols: number; rough: Box | null },
    colorbar: { bar: Box | null; marks: Mark[]; boxesText: string; how?: string },
    notes: string[],
    images: RenderedView[],
  ): Promise<ToolCallResult> {
    const { cells } = placed;
    const { bar, marks } = colorbar;
    const apart = bar && colorbar.how !== 'beside';
    if (apart) images.push(await barView(panel, bar, marks));
    const view = await panelView(
      cells,
      [...(placed.rough ? [placed.rough] : []), ...(bar && !apart ? [bar] : [])],
      apart ? [] : marks,
    );
    const text = [
      `Panel ${panel.id} "${name}": cells ${boxText(cells)}, ${placed.rows} row${placed.rows === 1 ? '' : 's'} × ${placed.cols} column${placed.cols === 1 ? '' : 's'} (counted by the app).`,
      bar ? `Colorbar ${orientation(bar)}, ${boxText(bar)}. ${colorbar.boxesText}` : '',
      ...notes,
      bar
        ? 'Next: set_ticks and set_labels from the image (and correct_grid_size if the lines merge or split cells).'
        : 'Next: set_labels, and the colorbar as above.',
    ]
      .filter(Boolean)
      .join(' ');
    images.unshift({
      dataUrl: view.dataUrl,
      note: `${name} (panel ${panel.id}): magenta grid${apart ? ' (its colorbar is in the next image)' : ', orange colorbar line, blue numbered tick-label boxes'}.`,
    });
    return { ok: true, result: text, images };
  }

  // ------------------------------------------------------------ checks

  // The app's own check: ready, tick values on the scale's line, and how
  // the cells' colors stand against the bar (extractPanel's counts).
  async function check(panel: Panel) {
    const res = ws.resultFor(panel) as HeatmapResult;
    if (res.error) return checkSummary({ problem: res.error });
    const cb = panel.colorbar;
    const ticks = ticksWithT(cb);
    const misfit = tickMisfit(ticks, cb.scale);
    // Box number of the worst tick, when it came from a numbered box.
    const marks = marksByPanel.get(panel) || [];
    const worst = misfit && ticks[misfit.index];
    const mark = worst
      ? marks.findIndex((m) => Math.abs(projectT(cb.start!, cb.end!, m.at) - worst.t) < VIEW.tickMatch) + 1 || null
      : null;
    const offMapReasons: Record<string, number> = {};
    for (const c of res.cells.flat())
      if (c.status === 'off-map') offMapReasons[c.reason!] = (offMapReasons[c.reason!] || 0) + 1;
    return checkSummary({
      counts: res.counts,
      clampedShare: res.clampedShare,
      offMapReasons,
      bins: res.bins?.length || 0,
      misfit,
      mark,
    });
  }

  // ------------------------------------------------------------ tools

  const handlers: Handlers = {
    async locate_heatmap({ name, description, panelId, box }) {
      const panel = await targetPanel(name, panelId);
      const notes: string[] = [];
      const images: RenderedView[] = [];
      const placed = await locateCells(panel, description, box, notes);
      await breathe();
      const colorbar = await pickColorbar(
        panel,
        name,
        placed.cells,
        { rows: placed.rows, cols: placed.cols },
        notes,
        images,
      );
      return locateResult(panel, name, placed, colorbar, notes, images);
    },

    async set_ticks({ panelId, ticks, scale }) {
      const panel = await takePanel(panelId);
      const cb = panel.colorbar;
      if (!cb.start || !cb.end) throw new Error('This panel has no colorbar yet. Use use_colorbar first.');
      const marks = marksByPanel.get(panel) || [];
      const bad = ticks.filter((k) => k.mark !== undefined && !marks[k.mark - 1]).map((k) => k.mark);
      if (bad.length)
        throw new Error(
          marks.length
            ? `No box ${bad.join(', ')}: the boxes are numbered 1 to ${marks.length}.`
            : 'This panel has no numbered boxes: give the ticks as {t, value}.',
        );
      await clearTicks(panel);
      for (const k of ticks) {
        const at = k.mark !== undefined ? { at: marks[k.mark - 1].at } : { t: tFromTopLeft(cb.start, cb.end, k.t!) };
        await act('add_tick', { panelId: panel.id, ...at, value: k.value });
      }
      let note = '';
      if (scale) await act('set_colorbar_scale', { panelId: panel.id, scale });
      else {
        // A binned bar labels its steps, often with uneven values.
        const binned = !!(ws.resultFor(panel) as HeatmapResult).bins;
        const s = (binned ? scaleForBins : scaleForTicks)(ticksWithT(panel.colorbar), panel.colorbar.scale);
        if (s) {
          await act('set_colorbar_scale', { panelId: panel.id, scale: s });
          note = scaleNote(s, binned);
        }
      }
      return {
        ok: true,
        result: `${ticks.length} ticks set.${note} ${(await check(panel)).text}`,
        image: await ticksView(panel),
      };
    },

    async use_colorbar({ panelId, candidate, fromPanel, box }) {
      const panel = await takePanel(panelId);
      if (!panel.grid.corners) throw new Error('This panel has no grid yet. Run locate_heatmap first.');
      if (fromPanel) {
        const src = app.project.panels.find((p) => p.id === fromPanel);
        if (!src) throw new Error(`No panel "${fromPanel}".`);
        if (src.id === panel.id) throw new Error('fromPanel is this panel.');
        if (src.page !== panel.page)
          throw new Error(`Panel ${src.id} is on page ${src.page}; a colorbar can only be shared on one page.`);
        const cb = src.colorbar;
        if (!cb.start || !cb.end) throw new Error(`Panel ${src.id} has no colorbar.`);
        await clearTicks(panel);
        await act('set_colorbar', {
          panelId: panel.id,
          start: cb.start,
          end: cb.end,
          halfWidth: cb.halfWidth,
          snap: false,
        });
        for (const k of ticksWithT(cb))
          if (Number.isFinite(k.t) && Number.isFinite(k.value))
            await act('add_tick', { panelId: panel.id, t: k.t, value: k.value, snap: false });
        await act('set_colorbar_scale', { panelId: panel.id, scale: cb.scale });
        marksByPanel.set(panel, marksByPanel.get(src) || []);
        candidatesByPanel.delete(panel);
        return {
          ok: true,
          result: `${panel.name} now uses the colorbar of ${src.name} (${cb.ticks.length} ticks, ${cb.scale}). ${(await check(panel)).text}`,
        };
      }
      let bar: Box | undefined;
      let note = '';
      if (candidate) {
        const list = candidatesByPanel.get(panel) || [];
        bar = list.find((c) => c.letter === candidate.trim().toUpperCase())?.bar;
        if (!bar)
          throw new Error(
            list.length
              ? `No candidate "${candidate}": they are ${list.map((c) => c.letter).join(', ')}.`
              : 'This panel has no colorbar candidates; use fromPanel or box.',
          );
      } else {
        const found = snapStripBox(page().imageData, clip(box!));
        if (!found)
          throw new Error(
            'No colored strip was found in that box. Check it on view_page, or place the ends with set_colorbar.',
          );
        bar = found.bar;
        if (found.extended)
          note = ` The colored strip found covers only ${Math.round(found.share * 100)}% of your box's length, so the colorbar was extended to your box: check its ends in the image (a pale end?).`;
      }
      const applied = await applyBar(panel, bar);
      const text = `Colorbar of ${panel.name}: ${orientation(applied.bar)}, ${boxText(applied.bar)}.${note} ${applied.text} Next: set_ticks.`;
      return { ok: true, result: text, image: await barView(panel, applied.bar, applied.marks) };
    },

    async correct_grid_size({ panelId, rows, cols, box }) {
      const panel = await takePanel(panelId);
      if (!panel.grid.corners) throw new Error('This panel has no grid yet. Run locate_heatmap first.');
      const notes = [];
      if (box) {
        const b = snapEdges(page().imageData, clip(box)) || clip(box);
        await setGridBox(panel, b);
        trimmedByPanel.delete(panel);
        notes.push(`Grid edges now at ${boxText(b)}.`);
      } else {
        // The count of a white end row or column the app left out puts it back.
        const cut = trimmedByPanel.get(panel);
        const g = gridBox(panel);
        const backRows = cut && cut.alt.row === rows;
        const backCols = cut && cut.alt.col === cols;
        if (backRows || backCols) {
          await setGridBox(panel, {
            x0: backCols ? cut.box.x0 : g.x0,
            x1: backCols ? cut.box.x1 : g.x1,
            y0: backRows ? cut.box.y0 : g.y0,
            y1: backRows ? cut.box.y1 : g.y1,
          });
          notes.push(
            `The white ${[backRows && 'row', backCols && 'column'].filter(Boolean).join(' and ')} is back in the grid.`,
          );
          trimmedByPanel.delete(panel);
        }
      }
      await act('set_grid_size', { panelId: panel.id, rows, cols });
      unsureByPanel.set(panel, { row: false, col: false });
      const view = await renderView({
        region: regions.grid(gridBox(panel), size().W, size().H),
        overlay: 'calibration',
        rulers: false,
        maxSide: VIEW.maxSide.grid,
      });
      return {
        ok: true,
        result: `Grid of ${panel.name} is now ${rows} rows × ${cols} columns. ${notes.join(' ')} ${(await check(panel)).text}`,
        image: { dataUrl: view.dataUrl, note: `${panel.name} (panel ${panel.id}) with the corrected grid.` },
      };
    },

    check_panel: async ({ panelId }) => ({ ok: true, result: (await check(await takePanel(panelId))).text }),

    // Printed numbers in cells against the extracted values (printedCheck).
    async check_printed({ panelId, cells }) {
      const panel = await takePanel(panelId);
      const res = ws.resultFor(panel) as HeatmapResult;
      if (res.error) throw new Error(`Not ready: ${res.error}`);
      const outside = cells.filter((c) => c.row > res.rows || c.col > res.cols);
      if (outside.length)
        throw new Error(
          `No cell at ${outside.map((c) => `row ${c.row}, column ${c.col}`).join('; ')}: the grid has ${res.rows} rows and ${res.cols} columns.`,
        );
      const values = ticksWithT(panel.colorbar)
        .map((k) => k.value)
        .filter(Number.isFinite);
      if (values.length < 2) throw new Error('This panel has no tick values yet. Use set_ticks first.');
      const pairs = cells.map((c) => {
        const x = res.cells[c.row - 1][c.col - 1];
        return {
          row: c.row,
          col: c.col,
          printed: c.value,
          value: Number.isFinite(x.value) ? x.value : null,
          open: x.open || null,
        };
      });
      return {
        ok: true,
        result: printedCheck(pairs, { min: Math.min(...values), max: Math.max(...values) }, panel.colorbar.scale).text,
      };
    },

    // The agent action, with the check after it (a scale change can make
    // or break the tick fit).
    async set_colorbar_scale(args) {
      const r = await api.run('set_colorbar_scale', args, { state: false });
      if (!r.ok) return r;
      const panel = await takePanel(args.panelId);
      return {
        ok: true,
        result: `Scale of ${panel.name} is now ${panel.colorbar.scale}. ${(await check(panel)).text}`,
      };
    },

    async ask({ region, overlay = 'none', questions }) {
      const view = await renderView({
        region,
        overlay,
        rulers: false,
        maxSide: region ? JEV.cropSide : JEV.pageSide,
        minSide: JEV.minSide,
        zoom: false,
      });
      const answers = await ask([imagePart(view.dataUrl)], questions);
      const out: Record<string, unknown> = {};
      for (const [id, a] of Object.entries(answers)) {
        const { type, ...rest } = a;
        out[id] = a.box ? { box: boxToPage(a.box, view.frame!), confidence: a.confidence } : rest;
      }
      return { ok: true, result: out };
    },
  };

  // Runs a handler with arguments its tool's schema has checked.
  const callHandler = (name: string, args: ActionArgs) =>
    (handlers[name as keyof DecisionArgsMap] as (a: ActionArgs) => Promise<ToolCallResult>)(args);

  return {
    prefetch,
    handles: (name) => name in DECISION_TOOLS || name === 'set_colorbar_scale',
    async call(name, rawArgs) {
      // set_colorbar_scale is checked by the agent API itself.
      if (!(name in DECISION_TOOLS)) return callHandler(name, rawArgs || {});
      const args = cleanDecisionArgs(name, rawArgs);
      const errs = validateDecisionTool(name, args!);
      if (errs.length) return { ok: false, error: errs.join('; ') };
      return callHandler(name, args!);
    },
  };
}

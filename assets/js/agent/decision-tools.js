(function (CM) {
  'use strict';
  const {
    ticksWithT, projectT, DECISION_TOOLS, cleanDecisionArgs, validateDecisionTool, decisionQuestions, boxToPage, growBox, besideBox, barLine, chooseColorbar, tFromTopLeft, scaleForBins, scaleForTicks,
    planGrid, regridOthers, tickMisfit, tickBoxesText, checkSummary, snapCells, pageColorbars, stripCandidate, snapEdges, snapStrip, findTickLabels, labelReach,
  } = CM;

  // Tools of "agent decision" mode (prompt, schemas and the pure choices in
  // agent/decide.js). Each request to the decision model is about one
  // heatmap and carries one image: the whole page, a crop around the
  // heatmap, or the strip beside it. Images for the decision model have no
  // rulers and are 300–1568 px a side, as Jev requires.
  //
  //   createDecisionTools(ws, api, {renderView, decide, model, usage, signal})
  //     → {handles(name), call(name, args)}
  // `decide` posts a Decisions API body (agent/openrouter-client.js).

  const JEV = { pageSide: 1568, cropSide: 1024, minSide: 300 };
  const r1 = (v) => Math.round(v * 10) / 10;
  const boxText = (b) => `x ${r1(b.x0)}–${r1(b.x1)}, y ${r1(b.y0)}–${r1(b.y1)}`;
  const imagePart = (url) => ({ type: 'image_url', image_url: { url } });
  const area = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);
  const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const iou = (a, b) => {
    const i = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    return i / (area(a) + area(b) - i);
  };
  const union = (bs) => ({ x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) });
  const orientation = (bar) => (bar.y1 - bar.y0 >= bar.x1 - bar.x0 ? 'vertical' : 'horizontal');
  const CANDIDATE_COLOR = '#e8590c';

  function createDecisionTools(ws, api, { renderView, decide, model, usage, signal }) {
    const { app } = ws;
    // Per panel: tick-label boxes numbered from 1, the lettered colorbar
    // candidates last shown, and the box before its grid was cut to the
    // counted cells (to put a white end row back).
    const marksByPanel = new Map();
    const candidatesByPanel = new Map();
    const trimmedByPanel = new Map();
    // Per panel: axes whose count the app was unsure of (a later panel lined
    // up with it may settle them).
    const unsureByPanel = new Map();

    async function ask(state, questions) {
      const res = await decide({ model, state, questions }, { signal });
      usage.decisions++;
      usage.decisionCost += res.usage?.cost || 0;
      return res.answers;
    }
    // One image of a page region and the questions about it.
    async function askRegion(region, questions, maxSide = JEV.cropSide) {
      const view = renderView({ region, rulers: false, maxSide, minSide: JEV.minSide, zoom: false });
      return { answers: await ask([imagePart(view.dataUrl)], questions), frame: view.frame };
    }

    const page = () => app.pages.get(ws.currentPage());
    const size = () => ({ W: page().canvas.width, H: page().canvas.height });
    const started = (p) => !!(p.grid.corners || p.colorbar.start || p.grid.rowLabels.length || p.grid.colLabels.length);
    const must = (r) => {
      if (!r.ok) throw new Error(r.error);
      return r.result;
    };
    const gridBox = (p) => {
      const xs = p.grid.corners.map((c) => c.x);
      const ys = p.grid.corners.map((c) => c.y);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    };
    const clip = (b) => {
      const { W, H } = size();
      return { x0: Math.max(0, Math.min(b.x0, b.x1)), y0: Math.max(0, Math.min(b.y0, b.y1)), x1: Math.min(W, Math.max(b.x0, b.x1)), y1: Math.min(H, Math.max(b.y0, b.y1)) };
    };
    // Cell boxes of every gridded panel on this page (the cells are no
    // colorbar and hold no tick labels).
    const cellBoxes = (extra = []) => [...ws.pagePanels().filter((p) => p.tool === 'heatmap' && p.grid.corners).map(gridBox), ...extra];

    // A named panel made active (switching page if needed), or the active one.
    async function usePanel(panelId) {
      if (panelId) must(await api.run('select_panel', { panelId }));
      const panel = panelId ? app.project.panels.find((p) => p.id === panelId) : ws.activePanel();
      if (!panel) throw new Error(`No panel "${panelId}".`);
      return panel;
    }

    // The panel to calibrate: the one named, the active one while it is
    // still empty, or a new one.
    async function targetPanel({ name, panelId }) {
      if (panelId) must(await api.run('select_panel', { panelId }));
      else {
        const active = ws.activePanel();
        if (!active || active.page !== ws.currentPage() || started(active)) must(await api.run('add_panel', { name }));
      }
      const panel = ws.activePanel();
      if (panel.name !== name) must(await api.run('rename_panel', { panelId: panel.id, name }));
      return panel;
    }

    // The cells from the decision model: roughly where on the whole page,
    // then the cells on a crop around that, each snapped to pixels.
    async function cellsFromJev(description, notes) {
      const img = page().imageData;
      const { W, H } = size();
      const found = await askRegion(null, decisionQuestions.find(description), JEV.pageSide);
      const present = found.answers.present?.noul;
      const rough = boxToPage(found.answers.cells.box, found.frame);
      const crop = await askRegion(growBox(rough, 0.25, 20, W, H), decisionQuestions.cells());
      const boxed = boxToPage(crop.answers.cells.box, crop.frame);
      let { cells, partial } = snapCells(img, rough, boxed);
      if (partial) notes.push(`The snapped cells cover only ${Math.round((100 * area(cells)) / area(rough))}% of where the decision model put the heatmap: if the grid holds only part of it, use correct_grid_size with box (its rough extent from the page rulers).`);
      if (!cells) {
        cells = boxed;
        notes.push('The cells could not be snapped to a block of color; the grid follows the decision model\'s box and may be off.');
      }
      if (Number.isFinite(present) && present < 0.5) notes.push(`The decision model doubts this heatmap matches the description (${r1(present)}): check the image.`);
      return { cells, rough: partial ? rough : null };
    }

    // Places the grid on `box` and settles rows and columns (planGrid in
    // agent/decide.js): the app counts them from the cell borders, or takes
    // them from a panel lined up with this one, and cuts the corners to the
    // counted cells when they include something else. Earlier panels whose
    // count was unsure take this one's when they line up with it.
    async function placeGrid(panel, box) {
      const setGrid = async (b) => must(await api.run('set_grid', { panelId: panel.id, topLeft: { x: b.x0, y: b.y0 }, bottomRight: { x: b.x1, y: b.y1 } }));
      const others = pageGrids().filter((g) => g.id !== panel.id);
      const plan = planGrid(page().imageData, box, others);
      await setGrid(plan.cells);
      trimmedByPanel.delete(panel.id);
      if (plan.cells !== box) trimmedByPanel.set(panel.id, { box, alt: plan.alt });
      if (panel.grid.rows !== plan.rows || panel.grid.cols !== plan.cols) must(await api.run('set_grid_size', { panelId: panel.id, rows: plan.rows, cols: plan.cols }));
      unsureByPanel.set(panel.id, plan.unsure);
      const notes = [...plan.notes];
      for (const u of regridOthers({ id: panel.id, name: panel.name, cells: plan.cells, rows: plan.rows, cols: plan.cols, unsure: plan.unsure }, others)) {
        must(await api.run('set_grid_size', { panelId: u.id, rows: u.rows, cols: u.cols }));
        unsureByPanel.set(u.id, { row: false, col: false });
        notes.push(u.note);
      }
      return { cells: plan.cells, rows: plan.rows, cols: plan.cols, note: notes.join(' ') };
    }

    // Gridded heatmap panels of this page for planGrid.
    const pageGrids = () =>
      ws.pagePanels().filter((p) => p.tool === 'heatmap' && p.grid.corners).map((p) => ({ id: p.id, name: p.name, cells: gridBox(p), rows: p.grid.rows, cols: p.grid.cols, unsure: unsureByPanel.get(p.id) }));

    // A label just past a pale end extends the strip to it (findTickLabels).
    async function applyBar(panel, strip) {
      for (const k of [...panel.colorbar.ticks]) must(await api.run('remove_tick', { panelId: panel.id, tickId: k.id }));
      const found = findTickLabels(page().imageData, strip, { exclude: cellBoxes() });
      const bar = found.bar || strip;
      must(await api.run('set_colorbar', { panelId: panel.id, ...barLine(strip) }));
      // The snap would cut the pale end off again.
      if (found.bar) must(await api.run('set_colorbar', { panelId: panel.id, ...barLine(bar), halfWidth: panel.colorbar.halfWidth, snap: false }));
      const marks = found.marks.map((m, i) => ({ ...m, label: String(i + 1) }));
      marksByPanel.set(panel.id, marks);
      candidatesByPanel.delete(panel.id);
      return { bar, marks, text: tickBoxesText(marks, { extended: !!found.bar }) };
    }

    // Colorbar candidates for cells: the strip at the decision model's box
    // beside them (on its two likeliest sides) and every colorbar found on
    // the page (findColorbars; categorical group strips left out), each with
    // its tick labels.
    async function colorbarCandidates(cells) {
      const img = page().imageData;
      const { W, H } = size();
      const exclude = cellBoxes([cells]);
      const { candidates: out, groups } = pageColorbars(img, exclude);
      // One strip right beside the cells needs no question.
      if (chooseColorbar(cells, out).how === 'beside') return { candidates: out, none: null };
      const side = (await askRegion(growBox(cells, 0.35, 20, W, H), decisionQuestions.side())).answers.side;
      const sides = Object.entries(side.probabilities || { [side.choice]: 1 })
        .filter(([k, pr]) => k !== 'none' && pr >= 0.05)
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => k)
        .slice(0, 2);
      // The decision model's box finds what the pixels miss (a gray colormap).
      if (side.choice !== 'none') {
        for (const s of sides) {
          const strip = besideBox(cells, s, W, H);
          if (strip.x1 - strip.x0 < 4 || strip.y1 - strip.y0 < 4) continue;
          const b = await askRegion(strip, decisionQuestions.bar());
          const c = stripCandidate(img, snapStrip(img, boxToPage(b.answers.bar.box, b.frame)), exclude, groups);
          if (c && !out.some((o) => overlaps(o.bar, c.bar))) out.push(c);
        }
      }
      return { candidates: out, none: side.choice === 'none' ? r1(side.probabilities?.none ?? side.confidence) : null };
    }

    // The page with lettered colorbar candidates, rulers for rough boxes.
    function candidatesView(list, name) {
      const view = renderView({ overlay: 'calibration', marks: list.map((c) => ({ box: c.bar, label: c.letter, color: CANDIDATE_COLOR })), zoom: false });
      return { dataUrl: view.dataUrl, note: `${name}: colorbar candidates in orange letters, on the page with its rulers. ${view.note}` };
    }

    // One image for the LLM: the cells with their own labels, colorbar and
    // numbered boxes, cropped at the white gaps around them so a
    // neighbouring panel's colorbar cannot be mistaken for this one. After a
    // partial snap it also shows the whole guessed area.
    function panelView(cells, extra, marks) {
      const img = page().imageData;
      const { W, H } = size();
      const ext = union([cells, ...extra, ...marks.map((m) => m.box)]);
      const reach = 300;
      const region = {
        x0: Math.max(0, Math.min(ext.x0, labelReach(img, cells, 'left', reach)) - 8),
        y0: Math.max(0, Math.min(ext.y0, labelReach(img, cells, 'above', reach)) - 8),
        x1: Math.min(W, Math.max(ext.x1, labelReach(img, cells, 'right', reach)) + 30),
        y1: Math.min(H, Math.max(ext.y1, labelReach(img, cells, 'below', reach)) + 8),
      };
      const view = renderView({ region, overlay: 'calibration', rulers: false, maxSide: 900, marks });
      ws.zoomToPoints([{ x: region.x0, y: region.y0 }, { x: region.x1, y: region.y1 }]);
      return view;
    }

    // A colorbar with its numbered tick-label boxes, on its own.
    function barView(panel, bar, marks) {
      const { W, H } = size();
      const region = growBox(union([bar, ...marks.map((m) => m.box)]), 0.1, 40, W, H);
      const view = renderView({ region, overlay: 'calibration', rulers: false, maxSide: 700, marks, zoom: false });
      return { dataUrl: view.dataUrl, note: `Colorbar of ${panel.name} (panel ${panel.id}) with numbered tick-label boxes.` };
    }

    async function locate({ name, description, panelId, box }) {
      const panel = await targetPanel({ name, panelId });
      const notes = [];
      // The LLM's own box (after the decision model found the wrong
      // heatmap) is trusted: its edges only move onto the cells' edges, and
      // the decision model is not asked (a bad crop answer overrode a good
      // box before).
      const located = box ? { cells: snapEdges(page().imageData, clip(box)) || clip(box), rough: null } : await cellsFromJev(description, notes);
      const placed = await placeGrid(panel, located.cells);
      const cells = placed.cells;
      if (placed.note) notes.push(placed.note);
      // The decision model can put two descriptions on one heatmap (t10:
      // the strip above a block was boxed as the block).
      const twin = pageGrids().find((g) => g.id !== panel.id && iou(g.cells, cells) > 0.8);
      if (twin) notes.push(`These cells are the same as panel ${twin.id} "${twin.name}"'s: one of the two found the wrong heatmap; locate it again with panelId and box.`);

      const { candidates, none } = await colorbarCandidates(cells);
      const choice = chooseColorbar(cells, candidates);
      let bar = null;
      let marks = [];
      let boxesText = '';
      const images = [];
      if (choice.bar) {
        bar = choice.bar;
        const applied = await applyBar(panel, bar);
        [bar, marks] = [applied.bar, applied.marks];
        boxesText = applied.text;
        const gap = Math.round(sideGap(cells, bar));
        if (choice.how === 'near') notes.push(`The colorbar is ${gap} px from the cells.`);
        if (choice.how === 'only') notes.push(`This is the only colorbar found on the page, ${gap} px from the cells: if it is not this heatmap's, use_colorbar with fromPanel or box.`);
      } else if (choice.list.length) {
        candidatesByPanel.set(panel.id, choice.list);
        marksByPanel.set(panel.id, []);
        const lines = choice.list.map((c) => `${c.letter}: ${orientation(c.bar)}, ${where(cells, c.bar)} the cells, ${c.gap} px away, ${boxText(c.bar)}, ${c.labels} tick label${c.labels === 1 ? '' : 's'}`);
        notes.push(`It is not clear which colorbar is this heatmap's. Candidates: ${lines.join('; ')}. Choose with use_colorbar {candidate}, or {fromPanel} if it shares a calibrated panel's colorbar.`);
        images.push(candidatesView(choice.list, name));
      } else {
        marksByPanel.set(panel.id, []);
        notes.push(`No colorbar was found${none !== null ? ` (the decision model sees none: ${none})` : ''}. If this heatmap has one, use_colorbar with box (its rough extent) or fromPanel; if it has none, remove_panel it.`);
      }

      // A colorbar away from the cells gets its own image; one image of
      // both would shrink the cells (test-1: 2600 px apart).
      const apart = bar && choice.how !== 'beside';
      if (apart) images.push(barView(panel, bar, marks));
      const view = panelView(cells, [...(located.rough ? [located.rough] : []), ...(bar && !apart ? [bar] : [])], apart ? [] : marks);
      const text = [
        `Panel ${panel.id} "${name}": cells ${boxText(cells)}, ${placed.rows} row${placed.rows === 1 ? '' : 's'} × ${placed.cols} column${placed.cols === 1 ? '' : 's'} (counted by the app).`,
        bar ? `Colorbar ${orientation(bar)}, ${boxText(bar)}. ${boxesText}` : '',
        ...notes,
        bar ? 'Next: set_ticks and set_labels from the image (and correct_grid_size if the lines merge or split cells).' : 'Next: set_labels, and the colorbar as above.',
      ].filter(Boolean).join(' ');
      images.unshift({ dataUrl: view.dataUrl, note: `${name} (panel ${panel.id}): magenta grid${apart ? ' (its colorbar is in the next image)' : ', orange colorbar line, blue numbered tick-label boxes'}.` });
      return { ok: true, result: text, images };
    }

    // Where a strip lies from the cells, in words: "right of and below".
    function where(cells, bar) {
      const h = bar.x0 >= cells.x1 - 2 ? 'right of' : bar.x1 <= cells.x0 + 2 ? 'left of' : '';
      const v = bar.y0 >= cells.y1 - 2 ? 'below' : bar.y1 <= cells.y0 + 2 ? 'above' : '';
      return [h, v].filter(Boolean).join(' and ') || 'over';
    }

    // Distance from the cells to a strip, for notes.
    function sideGap(cells, bar) {
      return Math.max(0, bar.x0 - cells.x1, cells.x0 - bar.x1, bar.y0 - cells.y1, cells.y0 - bar.y1);
    }

    async function useColorbar({ panelId, candidate, fromPanel, box }) {
      const panel = await usePanel(panelId);
      if (!panel.grid.corners) throw new Error('This panel has no grid yet. Run locate_heatmap first.');
      if (fromPanel) {
        const src = app.project.panels.find((p) => p.id === fromPanel);
        if (!src) throw new Error(`No panel "${fromPanel}".`);
        if (src.id === panel.id) throw new Error('fromPanel is this panel.');
        if (src.page !== panel.page) throw new Error(`Panel ${src.id} is on page ${src.page}; a colorbar can only be shared on one page.`);
        const cb = src.colorbar;
        if (!cb.start || !cb.end) throw new Error(`Panel ${src.id} has no colorbar.`);
        for (const k of [...panel.colorbar.ticks]) must(await api.run('remove_tick', { panelId: panel.id, tickId: k.id }));
        must(await api.run('set_colorbar', { panelId: panel.id, start: cb.start, end: cb.end, halfWidth: cb.halfWidth, snap: false }));
        for (const k of ticksWithT(cb)) if (Number.isFinite(k.t) && Number.isFinite(k.value)) must(await api.run('add_tick', { panelId: panel.id, t: k.t, value: k.value, snap: false }));
        must(await api.run('set_colorbar_scale', { panelId: panel.id, scale: cb.scale }));
        marksByPanel.set(panel.id, marksByPanel.get(src.id) || []);
        candidatesByPanel.delete(panel.id);
        return { ok: true, result: `${panel.name} now uses the colorbar of ${src.name} (${cb.ticks.length} ticks, ${cb.scale}). ${(await check(panel)).text}` };
      }
      let bar;
      if (candidate) {
        const list = candidatesByPanel.get(panel.id) || [];
        bar = list.find((c) => c.letter === candidate.trim().toUpperCase())?.bar;
        if (!bar) throw new Error(list.length ? `No candidate "${candidate}": they are ${list.map((c) => c.letter).join(', ')}.` : 'This panel has no colorbar candidates; use fromPanel or box.');
      } else {
        bar = snapStrip(page().imageData, clip(box));
        if (!bar) throw new Error('No colored strip was found in that box. Check it on view_page, or place the ends with set_colorbar.');
      }
      const applied = await applyBar(panel, bar);
      const text = `Colorbar of ${panel.name}: ${orientation(applied.bar)}, ${boxText(applied.bar)}. ${applied.text} Next: set_ticks.`;
      return { ok: true, result: text, image: barView(panel, applied.bar, applied.marks) };
    }

    async function setTicks({ panelId, ticks, scale }) {
      const panel = await usePanel(panelId);
      const cb = panel.colorbar;
      if (!cb.start || !cb.end) throw new Error('This panel has no colorbar yet. Use use_colorbar first.');
      const marks = marksByPanel.get(panel.id) || [];
      const bad = ticks.filter((k) => k.mark !== undefined && !marks[k.mark - 1]).map((k) => k.mark);
      if (bad.length) throw new Error(marks.length ? `No box ${bad.join(', ')}: the boxes are numbered 1 to ${marks.length}.` : 'This panel has no numbered boxes: give the ticks as {t, value}.');
      for (const k of [...cb.ticks]) must(await api.run('remove_tick', { panelId: panel.id, tickId: k.id }));
      for (const k of ticks) {
        const where = k.mark !== undefined ? { at: marks[k.mark - 1].at } : { t: tFromTopLeft(cb.start, cb.end, k.t) };
        must(await api.run('add_tick', { panelId: panel.id, ...where, value: k.value }));
      }
      let note = '';
      if (scale) must(await api.run('set_colorbar_scale', { panelId: panel.id, scale }));
      else if (ws.resultFor(panel).bins) {
        // A binned bar labels its steps, often with uneven values.
        const s = scaleForBins(ticksWithT(panel.colorbar), panel.colorbar.scale);
        if (s) {
          must(await api.run('set_colorbar_scale', { panelId: panel.id, scale: s }));
          note = ` The colorbar is binned, so the app set the scale to ${s}.`;
        }
      } else {
        const s = scaleForTicks(ticksWithT(panel.colorbar), panel.colorbar.scale);
        if (s) {
          must(await api.run('set_colorbar_scale', { panelId: panel.id, scale: s }));
          note = s === 'log10' ? ' The tick values grow by constant factors, so the app set the scale to log10.' : ` The ticks are unevenly spaced along the bar for their values, so the app set the scale to ${s} (values between neighbouring ticks).`;
        }
      }
      return { ok: true, result: `${ticks.length} ticks set.${note} ${(await check(panel)).text}`, image: ticksView(panel) };
    }

    // After set_ticks: the panel's grid and colorbar with the tick dots and
    // their values, so the LLM sees each dot level with its printed label
    // before finish (it rarely looked again by itself). Only the bar and its
    // labels when it lies far from the cells; 640 px at most.
    function ticksView(panel) {
      const { W, H } = size();
      const cb = panel.colorbar;
      const cells = gridBox(panel);
      const bar = { x0: Math.min(cb.start.x, cb.end.x) - 6, y0: Math.min(cb.start.y, cb.end.y) - 6, x1: Math.max(cb.start.x, cb.end.x) + 6, y1: Math.max(cb.start.y, cb.end.y) + 6 };
      const labels = (marksByPanel.get(panel.id) || []).map((m) => m.box);
      const apart = sideGap(cells, bar) > 0.5 * Math.max(cells.x1 - cells.x0, cells.y1 - cells.y0);
      const region = growBox(union(apart ? [bar, ...labels] : [cells, bar, ...labels]), 0.04, 20, W, H);
      const view = renderView({ region, overlay: 'calibration', rulers: false, maxSide: 640, zoom: false });
      return { dataUrl: view.dataUrl, note: `${panel.name} (panel ${panel.id}) after set_ticks: orange dots are the ticks with their values; each should sit level with its printed label${apart ? '' : ', and the magenta grid on the cells'}.` };
    }

    // The app's own check: ready, tick values on the scale's line, and how
    // the cells' colors stand against the bar (extractPanel's counts).
    async function check(panel) {
      const res = ws.resultFor(panel);
      if (res.error) return checkSummary({ problem: res.error });
      const cb = panel.colorbar;
      const ticks = ticksWithT(cb);
      const misfit = tickMisfit(ticks, cb.scale);
      // Box number of the worst tick, when it came from a numbered box.
      const marks = marksByPanel.get(panel.id) || [];
      const worst = misfit && ticks[misfit.index];
      const mark = worst ? marks.findIndex((m) => Math.abs(projectT(cb.start, cb.end, m.at) - worst.t) < 0.03) + 1 || null : null;
      const offMapReasons = {};
      for (const c of res.cells.flat()) if (c.status === 'off-map') offMapReasons[c.reason] = (offMapReasons[c.reason] || 0) + 1;
      return checkSummary({ counts: res.counts, clampedShare: res.clampedShare, offMapReasons, bins: res.bins?.length || 0, misfit, mark });
    }

    async function correctGridSize({ panelId, rows, cols, box }) {
      const panel = await usePanel(panelId);
      if (!panel.grid.corners) throw new Error('This panel has no grid yet. Run locate_heatmap first.');
      const notes = [];
      const setGrid = async (b) => must(await api.run('set_grid', { panelId: panel.id, topLeft: { x: b.x0, y: b.y0 }, bottomRight: { x: b.x1, y: b.y1 } }));
      if (box) {
        const b = snapEdges(page().imageData, clip(box)) || clip(box);
        await setGrid(b);
        trimmedByPanel.delete(panel.id);
        notes.push(`Grid edges now at ${boxText(b)}.`);
      } else {
        // The count of a white end row or column the app left out puts it back.
        const cut = trimmedByPanel.get(panel.id);
        const g = gridBox(panel);
        const backRows = cut && cut.alt.row === rows;
        const backCols = cut && cut.alt.col === cols;
        if (backRows || backCols) {
          await setGrid({ x0: backCols ? cut.box.x0 : g.x0, x1: backCols ? cut.box.x1 : g.x1, y0: backRows ? cut.box.y0 : g.y0, y1: backRows ? cut.box.y1 : g.y1 });
          notes.push(`The white ${[backRows && 'row', backCols && 'column'].filter(Boolean).join(' and ')} is back in the grid.`);
          trimmedByPanel.delete(panel.id);
        }
      }
      must(await api.run('set_grid_size', { panelId: panel.id, rows, cols }));
      unsureByPanel.set(panel.id, { row: false, col: false });
      const view = renderView({ region: growBox(gridBox(panel), 0.05, 10, size().W, size().H), overlay: 'calibration', rulers: false, maxSide: 900 });
      return { ok: true, result: `Grid of ${panel.name} is now ${rows} rows × ${cols} columns. ${notes.join(' ')} ${(await check(panel)).text}`, image: { dataUrl: view.dataUrl, note: `${panel.name} (panel ${panel.id}) with the corrected grid.` } };
    }

    async function askTool({ region, overlay = 'none', questions }) {
      const view = renderView({ region, overlay, rulers: false, maxSide: region ? JEV.cropSide : JEV.pageSide, minSide: JEV.minSide, zoom: false });
      const answers = await ask([imagePart(view.dataUrl)], questions);
      const out = {};
      for (const [id, a] of Object.entries(answers)) {
        const { type, ...rest } = a;
        out[id] = a.box ? { box: boxToPage(a.box, view.frame), confidence: a.confidence } : rest;
      }
      return { ok: true, result: out };
    }

    const handlers = {
      locate_heatmap: locate,
      set_ticks: setTicks,
      use_colorbar: useColorbar,
      correct_grid_size: correctGridSize,
      check_panel: async ({ panelId }) => ({ ok: true, result: (await check(await usePanel(panelId))).text }),
      // The agent action, with the check after it (a scale change can make
      // or break the tick fit).
      set_colorbar_scale: async (args) => {
        const r = await api.run('set_colorbar_scale', args);
        if (!r.ok) return r;
        const panel = await usePanel(args.panelId);
        return { ok: true, result: `Scale of ${panel.name} is now ${panel.colorbar.scale}. ${(await check(panel)).text}` };
      },
      ask: askTool,
    };

    return {
      handles: (name) => name in DECISION_TOOLS || name === 'set_colorbar_scale',
      async call(name, rawArgs) {
        if (!(name in DECISION_TOOLS)) return handlers[name](rawArgs || {});
        const args = cleanDecisionArgs(name, rawArgs);
        const errs = validateDecisionTool(name, args);
        if (errs.length) return { ok: false, error: errs.join('; ') };
        return handlers[name](args);
      },
    };
  }

  Object.assign(CM, { createDecisionTools });
})((globalThis.Colormeris ??= {}));

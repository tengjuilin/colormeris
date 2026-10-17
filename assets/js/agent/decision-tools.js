(function (CM) {
  'use strict';
  const { rgbToLab, ticksWithT, projectT, DECISION_TOOLS, validateDecisionTool, decisionQuestions, boxToPage, growBox, besideBox, barLine, besideCheck, tickMisfit, checkSummary, snapBlock, findStrip, findTickLabels, labelReach, fitCellCounts } = CM;

  // Tools of "agent decision" mode (prompt and schemas in agent/decide.js).
  // Each request to the decision model is about one heatmap and carries one
  // image: the whole page, a crop around the heatmap, or the strip beside it. Images for the decision model have no rulers and are
  // 300–1568 px a side, as Jev requires.
  //
  //   createDecisionTools(ws, api, {renderView, decide, model, usage, signal})
  //     → {handles(name), call(name, args)}
  // `decide` posts a Decisions API body (agent/openrouter-client.js).

  const JEV = { pageSide: 1568, cropSide: 1024, minSide: 300 };
  const r1 = (v) => Math.round(v * 10) / 10;
  const boxText = (b) => `x ${r1(b.x0)}–${r1(b.x1)}, y ${r1(b.y0)}–${r1(b.y1)}`;
  const imagePart = (url) => ({ type: 'image_url', image_url: { url } });

  function createDecisionTools(ws, api, { renderView, decide, model, usage, signal }) {
    const { app } = ws;
    // Tick-label boxes found by locate_heatmap, per panel, numbered from 1.
    const marksByPanel = new Map();

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

    async function locate({ name, description, panelId, box }) {
      const panel = await targetPanel({ name, panelId });
      const img = page().imageData;
      const { W, H } = size();
      const notes = [];

      // 1. Roughly where, on the whole page; 2. the cells, on a crop around that.
      // The LLM's own rough box, after a miss, replaces Jev's page-wide guess.
      const clip = (b) => ({ x0: Math.max(0, Math.min(b.x0, b.x1)), y0: Math.max(0, Math.min(b.y0, b.y1)), x1: Math.min(W, Math.max(b.x0, b.x1)), y1: Math.min(H, Math.max(b.y0, b.y1)) });
      const found = box ? null : await askRegion(null, decisionQuestions.find(description), JEV.pageSide);
      const present = found?.answers.present?.noul;
      const rough = box ? clip(box) : boxToPage(found.answers.cells.box, found.frame);
      const crop = await askRegion(growBox(rough, 0.25, 20, W, H), decisionQuestions.cells());
      const boxed = boxToPage(crop.answers.cells.box, crop.frame);
      // A crop box on a pale edge column has no solid core to snap from;
      // the page-wide box then still reaches the block.
      // A short crop box can also stop the snap at a pale row (the 24h
      // cytokine heatmap: 6 of 32 rows); a page-wide snap that holds it and
      // is much larger then wins, unless it outgrew Jev's page box (a
      // neighbouring heatmap joined in).
      const near = snapBlock(img, boxed);
      const wide = snapBlock(img, rough);
      const area = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);
      const holds = (a, b) => a.x0 <= b.x0 + 3 && a.y0 <= b.y0 + 3 && a.x1 >= b.x1 - 3 && a.y1 >= b.y1 - 3;
      let cells = near && wide && holds(wide, near) && area(near) < 0.6 * area(wide) && area(wide) < 1.5 * area(rough) ? wide : near || wide;
      // A snap far smaller than Jev's page box caught one corner of the
      // heatmap (once on a 12 × 32 heatmap: 2 × 2 cells); the LLM re-locates.
      const partial = !!cells && area(cells) < 0.3 * area(rough);
      if (partial) notes.push(`The snapped cells cover only ${Math.round((100 * area(cells)) / area(rough))}% of where the decision model put the heatmap: if the grid holds only part of it, call locate_heatmap again with panelId and box (its rough extent from the page image's rulers).`);
      if (!cells) {
        cells = boxed;
        notes.push('The cells could not be snapped to a block of color; the grid follows the decision model\'s box and may be off.');
      }
      const grid = must(await api.run('set_grid', { panelId: panel.id, topLeft: { x: cells.x0, y: cells.y0 }, bottomRight: { x: cells.x1, y: cells.y1 } })).detected;
      const counted = await settleCounts(panel, grid);
      if (counted.note) notes.push(counted.note);

      // 3. Which side the colorbar is on; 4. the colorbar, beside the cells.
      // A neighbouring heatmap's colorbar can sit on the other side, so a
      // strip that is far from the cells or does not run along them is
      // dropped and the next likeliest side tried.
      const side = (await askRegion(growBox(cells, 0.35, 20, W, H), decisionQuestions.side())).answers.side;
      const sides = Object.entries(side.probabilities || { [side.choice]: 1 })
        .filter(([k, pr]) => k !== 'none' && pr >= 0.05)
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => k)
        .slice(0, 2);
      let bar = null;
      let barSide = null;
      let marks = [];
      if (side.choice !== 'none') {
        // A side whose strip has its labels on the far side wins; one
        // without labels found is kept only as a fallback.
        let fallback = null;
        for (const s of sides) {
          const strip = besideBox(cells, s, W, H);
          const b = await askRegion(strip, decisionQuestions.bar());
          // When Jev's box misses the strip, look for it in the pixels.
          let found = snapBlock(img, boxToPage(b.answers.bar.box, b.frame));
          if (!found || !besideCheck(cells, found, s)) found = findStrip(img, strip);
          if (!found || !besideCheck(cells, found, s)) continue;
          const labels = findTickLabels(img, found);
          if (!labels.marks.length) fallback ??= { found, s };
          else if (besideCheck(cells, found, s, labels.side)) {
            [bar, barSide] = [found, s];
            break;
          }
        }
        if (!bar && fallback) [bar, barSide] = [fallback.found, fallback.s];
      }
      if (!bar) notes.push(side.choice === 'none' ? `The decision model sees no colorbar (${r1(side.probabilities?.none ?? side.confidence)}). Place it with set_colorbar if there is one.` : 'No colorbar was found next to the cells. Place it with set_colorbar.');
      else {
        const line = barLine(bar);
        const set = must(await api.run('set_colorbar', { panelId: panel.id, ...line }));
        if (/No colored strip/.test(set.note)) notes.push('No colored strip was found where the decision model put the colorbar.');
        marks = findTickLabels(img, bar).marks.map((m, i) => ({ ...m, label: String(i + 1) }));
      }
      marksByPanel.set(panel.id, marks);

      // One image for the LLM: the cells with their own labels, colorbar and
      // numbered boxes, cropped at the white gaps around them so a
      // neighbouring panel's colorbar cannot be mistaken for this one.
      // After a partial snap the image also shows the whole guessed area, so
      // the LLM can see what the grid missed.
      const all = [cells, ...(partial ? [rough] : []), ...(bar ? [bar] : []), ...marks.map((m) => m.box)];
      const ext = { x0: Math.min(...all.map((b) => b.x0)), y0: Math.min(...all.map((b) => b.y0)), x1: Math.max(...all.map((b) => b.x1)), y1: Math.max(...all.map((b) => b.y1)) };
      const reach = 300;
      const region = {
        x0: Math.max(0, Math.min(ext.x0, labelReach(img, cells, 'left', reach)) - 8),
        y0: Math.max(0, Math.min(ext.y0, labelReach(img, cells, 'above', reach)) - 8),
        x1: Math.min(W, Math.max(ext.x1, labelReach(img, cells, 'right', reach)) + 30),
        y1: Math.min(H, Math.max(ext.y1, labelReach(img, cells, 'below', reach)) + 8),
      };
      const view = renderView({ region, overlay: 'calibration', rulers: false, maxSide: 900, marks });
      ws.zoomToPoints([{ x: region.x0, y: region.y0 }, { x: region.x1, y: region.y1 }]);

      const text = [
        `Panel ${panel.id} "${name}": cells ${boxText(cells)}, ${counted.rows} rows × ${counted.cols} columns (counted by the app).`,
        bar ? `Colorbar ${bar.y1 - bar.y0 >= bar.x1 - bar.x0 ? 'vertical' : 'horizontal'}, ${barSide === 'left' || barSide === 'right' ? `${barSide} of` : barSide} the cells, ${boxText(bar)}; ${marks.length} tick-label box${marks.length === 1 ? '' : 'es'} numbered in reading order.` : '',
        Number.isFinite(present) && present < 0.5 ? `The decision model doubts this heatmap matches the description (${r1(present)}): check the image.` : '',
        ...notes,
        'Next: set_ticks and set_labels from the image (and correct_grid_size if the lines merge or split cells).',
      ].filter(Boolean).join(' ');
      return { ok: true, result: text, image: { dataUrl: view.dataUrl, note: `${name} (panel ${panel.id}): magenta grid, orange colorbar line, blue numbered tick-label boxes.` } };
    }

    // The app counts rows and columns. set_grid detects them from the
    // spacing of color edges; on snapped corners fitCellCounts also knows
    // where the borders must be, which keeps groups of similar replicate
    // cells apart. It wins when its fit is clean. The LLM never sets counts.
    const CLEAN_FIT = 0.7;
    async function settleCounts(panel, grid) {
      const fit = fitCellCounts(page().imageData, panel.grid.corners);
      const out = { rows: grid.rows, cols: grid.cols };
      if (fit.rowScore >= CLEAN_FIT) out.rows = fit.rows;
      if (fit.colScore >= CLEAN_FIT) out.cols = fit.cols;
      if (out.rows !== grid.rows || out.cols !== grid.cols) must(await api.run('set_grid_size', { panelId: panel.id, ...out }));
      const unsure = (fit.rowScore < CLEAN_FIT && grid.rowConfidence < 1.3) || (fit.colScore < CLEAN_FIT && grid.colConfidence < 1.3);
      // Its two counts disagree when cells come in groups of similar
      // replicates (strong group borders, faint ones inside): say both.
      const other = [fit.rows !== grid.rows && `${fit.rows} or ${grid.rows} rows`, fit.cols !== grid.cols && `${fit.cols} or ${grid.cols} columns`].filter(Boolean);
      const notes = [unsure && 'The app is unsure of its row or column count.', other.length && `Its two counts disagree (${other.join(', ')}): check the magenta lines and use correct_grid_size if they merge or split cells.`];
      return { ...out, note: notes.filter(Boolean).join(' ') };
    }

    async function setTicks({ panelId, ticks, scale }) {
      const panel = panelId ? app.project.panels.find((p) => p.id === panelId) : ws.activePanel();
      if (!panel) throw new Error(`No panel "${panelId}".`);
      const marks = marksByPanel.get(panel.id);
      if (!marks?.length) throw new Error('This panel has no numbered tick-label boxes. Run locate_heatmap first, or use add_tick with "at".');
      const bad = ticks.filter((k) => !marks[k.mark - 1]).map((k) => k.mark);
      if (bad.length) throw new Error(`No box ${bad.join(', ')}: the boxes are numbered 1 to ${marks.length}.`);
      for (const k of [...panel.colorbar.ticks]) must(await api.run('remove_tick', { panelId: panel.id, tickId: k.id }));
      for (const k of ticks) must(await api.run('add_tick', { panelId: panel.id, at: marks[k.mark - 1].at, value: k.value }));
      if (scale) must(await api.run('set_colorbar_scale', { panelId: panel.id, scale }));
      return { ok: true, result: `${ticks.length} ticks set. ${(await check(panel)).text}` };
    }

    // The app's own check: ready, tick values on a line, flagged cells.
    async function check(panel) {
      const res = ws.resultFor(panel);
      if (res.error) return checkSummary({ problem: res.error });
      const all = res.cells.flat().filter((c) => !c.empty);
      const cb = panel.colorbar;
      const ticks = ticksWithT(cb);
      const misfit = tickMisfit(ticks, cb.scale);
      // Box number of the worst tick, when it came from a numbered box.
      const marks = marksByPanel.get(panel.id) || [];
      const worst = misfit && ticks[misfit.index];
      const mark = worst ? marks.findIndex((m) => Math.abs(projectT(cb.start, cb.end, m.at) - worst.t) < 0.03) + 1 || null : null;
      const flagged = all.filter((c) => c.flagged);
      // Lighter or darker than every color on the bar (by L*): the figure's
      // cells go past its colorbar. (t is no help: a bar that is flat near
      // its end puts such cells anywhere along the flat part.)
      const L = (res.samples || []).map((x) => x.lab[0]);
      const beyond = L.length ? flagged.filter((c) => c.rgb && (rgbToLab(c.rgb)[0] > Math.max(...L) + 3 || rgbToLab(c.rgb)[0] < Math.min(...L) - 3)).length : 0;
      return checkSummary({ flagged: flagged.length, cells: all.length, misfit, mark, beyond });
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
      correct_grid_size: async ({ panelId, rows, cols }) => {
        const panel = panelId ? app.project.panels.find((p) => p.id === panelId) : ws.activePanel();
        if (!panel) throw new Error(`No panel "${panelId}".`);
        if (!panel.grid.corners) throw new Error('This panel has no grid yet. Run locate_heatmap first.');
        must(await api.run('set_grid_size', { panelId: panel.id, rows, cols }));
        const view = renderView({ region: growBox(gridBox(panel), 0.05, 10, size().W, size().H), overlay: 'calibration', rulers: false, maxSide: 900 });
        return { ok: true, result: `Grid of ${panel.name} is now ${rows} rows × ${cols} columns. ${(await check(panel)).text}`, image: { dataUrl: view.dataUrl, note: `${panel.name} (panel ${panel.id}) with the corrected grid.` } };
      },
      check_panel: async ({ panelId }) => {
        const panel = panelId ? app.project.panels.find((p) => p.id === panelId) : ws.activePanel();
        if (!panel) throw new Error(`No panel "${panelId}".`);
        return { ok: true, result: (await check(panel)).text };
      },
      ask: askTool,
    };

    return {
      handles: (name) => name in DECISION_TOOLS,
      async call(name, args) {
        const errs = validateDecisionTool(name, args);
        if (errs.length) return { ok: false, error: errs.join('; ') };
        return handlers[name](args);
      },
    };
  }

  Object.assign(CM, { createDecisionTools });
})((globalThis.Colormeris ??= {}));

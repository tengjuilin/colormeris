(function (CM) {
  'use strict';
  const { extractPanel, panelProblem, effectiveLabels, cellSamplePolygon, outerCorners, cornerCellCenters, ANCHOR_DEFAULTS, bilinear, colorAtT, rgbToHex, formatNumber, toWideCsv, toLongCsv, heatmapPanelFiles } = CM;

  // Heatmap tool: extract one value per grid cell by matching the cell's color
  // against the calibrated colorbar. setupHeatmapTool(ws) registers it with a
  // workspace (workspace.js).

  function setupHeatmapTool(ws) {
  const state = { showRecon: false };
  const { $, app, viewer } = ws;

  ws.addTool({
    kind: 'heatmap',
    label: 'heatmap',
    title: 'Colormeris · Heatmap',
    computeResult: (panel, image) => extractPanel(image, panel),
    resultKey: (panel) => [panel.grid, panel.colorbar, panel.settings],
    panelProblem,
    panelFiles: (panels, results, bases) => panels.flatMap((p, i) => heatmapPanelFiles(p, results[i], bases[i])),
    sections: ['sec-hm-results'],
    gridTexts: ['Click the outer top-left corner of the heatmap.', 'Click the outer bottom-right corner.'],
    renderSidebar,
    drawUnderGrid,
    drawOverGrid,
    hoverText,
    onHoverCell: (cell) => highlightTableCell(cell),
  });

  // ---------------------------------------------------------------- overlay

  // Adds a closed polygon to the current path (ws.polyPath starts a new one).
  function addPolygon(ctx, v, pts) {
    pts.forEach((q, i) => {
      const s = v.toScreen(q);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
  }

  // result.cells → cells grouped by the hex color of their repainted value,
  // kept per result: the colors only change with the values, but the overlay
  // redraws on every pan, zoom and hover.
  const reconColors = new WeakMap();
  function reconColorsFor(result) {
    let hit = reconColors.get(result);
    if (!hit) {
      hit = new Map();
      result.cells.forEach((row, r) =>
        row.forEach((c, k) => {
          if (c.empty) return;
          const hex = rgbToHex(colorAtT(result.samples, c.t));
          if (!hit.has(hex)) hit.set(hex, []);
          hit.get(hex).push([r, k]);
        }),
      );
      reconColors.set(result, hit);
    }
    return hit;
  }

  // Reconstruction: repaint each sampled area with the color its value maps to,
  // one path and fill per color.
  function drawUnderGrid(ctx, v, panel, active) {
    if (!active || !state.showRecon) return;
    const result = ws.resultFor(panel);
    if (!result.cells) return;
    const g = panel.grid;
    for (const [hex, cells] of reconColorsFor(result)) {
      ctx.beginPath();
      for (const [r, k] of cells) addPolygon(ctx, v, cellSamplePolygon(g, r, k, result.cells[r][k].radius));
      ctx.fillStyle = hex;
      ctx.fill();
    }
  }

  // Sampled areas (when cells are large enough to read) and flagged cells,
  // each kind stroked as one path.
  function drawOverGrid(ctx, v, panel, active) {
    if (!active) return;
    const g = panel.grid;
    const c = outerCorners(g);
    // With dot centers the sampled circles follow each dot's radius from the result.
    const result = ws.resultFor(panel);
    const radius = (r, k) => result.cells?.[r]?.[k]?.radius ?? null;
    const cellPx = Math.min(
      (Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y) / g.cols) * v.scale,
      (Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y) / g.rows) * v.scale,
    );
    if (cellPx > 10 && !state.showRecon) {
      // The outline adapts to the sampled color: dark on light cells, white on
      // dark ones. Before there is a result, white dashes over a dark line.
      const light = new Path2D();
      const dark = new Path2D();
      const unknown = new Path2D();
      for (let r = 0; r < g.rows; r++) {
        for (let k = 0; k < g.cols; k++) {
          const cell = result.cells?.[r][k];
          if (cell?.empty) continue;
          const path = !cell ? unknown : luminance(cell.rgb) > 0.45 ? light : dark;
          addPolygon(path, v, cellSamplePolygon(g, r, k, radius(r, k)));
        }
      }
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke(unknown);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.stroke(light);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke(dark);
      ctx.stroke(unknown);
      ctx.setLineDash([]);
    }
    if (!result.cells) return;
    ctx.beginPath();
    for (let r = 0; r < g.rows; r++) {
      for (let k = 0; k < g.cols; k++) {
        if (result.cells[r][k].flagged) addPolygon(ctx, v, cellSamplePolygon(g, r, k, radius(r, k)));
      }
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = ws.COLORS.flag;
    ctx.stroke();
    // Empty cells (no dot found) get a small cross at their center.
    if (cellPx > 6) {
      ctx.beginPath();
      const s = Math.min(5, cellPx / 6);
      for (let r = 0; r < g.rows; r++) {
        for (let k = 0; k < g.cols; k++) {
          if (!result.cells[r][k].empty) continue;
          const p = v.toScreen(bilinear(c, (k + 0.5) / g.cols, (r + 0.5) / g.rows));
          ctx.moveTo(p.x - s, p.y - s);
          ctx.lineTo(p.x + s, p.y + s);
          ctx.moveTo(p.x + s, p.y - s);
          ctx.lineTo(p.x - s, p.y + s);
        }
      }
      // Dark with a white border, so it shows on the usual white background and on dark figures.
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.stroke();
    }
  }

  function hoverText(panel, cell) {
    if (!cell) return '';
    const rl = effectiveLabels(panel.grid.rowLabels, panel.grid.rows, 'R')[cell.row];
    const cl = effectiveLabels(panel.grid.colLabels, panel.grid.cols, 'C')[cell.col];
    const c = ws.resultFor(panel).cells?.[cell.row]?.[cell.col];
    if (c?.empty) return `${rl} / ${cl}: no dot`;
    return c ? `${rl} / ${cl}: ${formatNumber(c.value)}  (ΔE ${c.deltaE.toFixed(1)})` : `${rl} / ${cl}`;
  }

  // ---------------------------------------------------------------- sidebar

  function renderSidebar(panel) {
    const g = panel.grid;
    const dots = g.anchor === 'centers';
    ws.setValue($('grid-anchor'), g.anchor);
    ws.setValue($('grid-shape'), g.shape);
    $('grid-place-label').textContent = dots ? 'Place corner dots' : 'Place grid corners';
    $('grid-fraction-field').title = dots
      ? "Share of each dot's own radius that is averaged; lower it to stay clear of the dot's edge"
      : 'Share of each cell that is averaged around its center; lower it to stay clear of cell borders';
    $('grid-detect').title = dots ? 'Type rows and columns: detection needs cell borders, which dot plots lack' : 'Guess rows and columns from the image inside the grid';
    if (dots) $('grid-detect').disabled = true;
    ws.setValue($('grid-fraction'), panel.grid.sampleFraction);
    $('grid-fraction-out').textContent = `${Math.round(panel.grid.sampleFraction * 100)}%`;
    renderResults(panel);
  }

  function renderResults(panel) {
    const res = ws.resultFor(panel);
    const table = $('result-table');
    $('dl-csv').disabled = $('dl-long').disabled = $('copy-tsv').disabled = !!res.error;
    if (res.error) {
      $('result-problem').textContent = res.error;
      $('result-summary').textContent = '';
      table.replaceChildren();
      return;
    }
    $('result-problem').textContent = '';
    const values = res.cells.flat().map((c) => c.value).filter(Number.isFinite);
    const flagged = res.cells.flat().filter((c) => c.flagged).length;
    const empty = res.cells.flat().length - values.length;
    $('result-summary').textContent =
      `${res.rows} × ${res.cols} cells` +
      (values.length ? ` · range ${formatNumber(Math.min(...values))} – ${formatNumber(Math.max(...values))}` : '') +
      (empty ? ` · ${empty} without a dot (blank)` : '') +
      ` · ${flagged ? `${flagged} flagged (ΔE > ${panel.settings.maxDeltaE}) — outlined in red` : 'no flagged cells'}`;

    const rowLabels = effectiveLabels(panel.grid.rowLabels, res.rows, 'R');
    const colLabels = effectiveLabels(panel.grid.colLabels, res.cols, 'C');
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    hr.append(th('', true), ...colLabels.map((l) => th(l)));
    thead.append(hr);
    const tbody = document.createElement('tbody');
    res.cells.forEach((row, r) => {
      const tr = document.createElement('tr');
      tr.append(th(rowLabels[r], true));
      row.forEach((c, k) => {
        const td = document.createElement('td');
        td.dataset.r = r;
        td.dataset.c = k;
        if (c.empty) {
          td.textContent = '–';
          td.title = `${rowLabels[r]} / ${colLabels[k]}\nno dot (blank)`;
          tr.append(td);
          return;
        }
        td.textContent = Number(c.value.toPrecision(4)).toString();
        td.style.background = rgbToHex(c.rgb);
        td.style.color = luminance(c.rgb) > 0.45 ? '#111' : '#fff';
        td.title = `${rowLabels[r]} / ${colLabels[k]}\nvalue ${formatNumber(c.value)}\nΔE ${c.deltaE.toFixed(2)}`;
        td.dataset.r = r;
        td.dataset.c = k;
        if (c.flagged) td.classList.add('flagged');
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.replaceChildren(thead, tbody);
    highlightTableCell(app.hoverCell);
  }

  function th(text, rowhead = false) {
    const el = document.createElement('th');
    el.textContent = text;
    if (rowhead) el.className = 'rowhead';
    return el;
  }

  function luminance([r, g, b]) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function highlightTableCell(cell) {
    const table = $('result-table');
    table.querySelector('td.hl')?.classList.remove('hl');
    if (cell) table.querySelector(`td[data-r="${cell.row}"][data-c="${cell.col}"]`)?.classList.add('hl');
    viewer.requestDraw();
  }

  async function copyTsv() {
    const panel = ws.activePanel();
    const res = ws.resultFor(panel);
    if (res.error) return;
    const tsv = toWideCsv(panel, res)
      .trim()
      .split('\n')
      .map((line) => line.replace(/"([^"]|"")*"|,/g, (m) => (m === ',' ? '\t' : m.slice(1, -1).replace(/""/g, '"'))))
      .join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      ws.toast('Table copied — paste into a spreadsheet.');
    } catch {
      ws.toast('Clipboard is not available here.', true);
    }
  }

  // ---------------------------------------------------------------- bindings

  ws.bindNumber('grid-fraction', (p, v) => (p.grid.sampleFraction = v));
  // Switching what the clicks mean keeps the same cells: placed points are
  // converted, and the shape and sampled area take the new mode's defaults.
  $('grid-anchor').addEventListener('change', () => {
    const anchor = $('grid-anchor').value;
    ws.commit((p) => {
      const g = p.grid;
      if (g.anchor === anchor) return;
      if (g.corners) g.corners = anchor === 'centers' ? cornerCellCenters(g.corners, g.rows, g.cols) : outerCorners(g);
      g.anchor = anchor;
      Object.assign(g, ANCHOR_DEFAULTS[anchor]);
    });
    // Start placing right away: the old points no longer mean the same thing.
    ws.setMode('grid');
  });
  $('grid-shape').addEventListener('change', () => ws.commit((p) => (p.grid.shape = $('grid-shape').value)));
  $('toggle-recon').addEventListener('change', (e) => {
    state.showRecon = e.target.checked;
    viewer.requestDraw();
  });
  $('dl-csv').addEventListener('click', () => {
    const p = ws.activePanel();
    const r = ws.resultFor(p);
    if (!r.error) ws.download(new Blob([toWideCsv(p, r)], { type: 'text/csv' }), ws.csvName(p));
  });
  $('dl-long').addEventListener('click', () => {
    const p = ws.activePanel();
    const r = ws.resultFor(p);
    if (!r.error) ws.download(new Blob([toLongCsv([{ panel: p, result: r }])], { type: 'text/csv' }), ws.csvName(p, '_long'));
  });
  $('copy-tsv').addEventListener('click', copyTsv);
  $('result-table').addEventListener('pointerover', (e) => {
    const td = e.target.closest('td');
    app.tableCell = td ? { row: Number(td.dataset.r), col: Number(td.dataset.c) } : null;
    viewer.requestDraw();
  });
  $('result-table').addEventListener('pointerleave', () => {
    app.tableCell = null;
    viewer.requestDraw();
  });

  }

  Object.assign(CM, { setupHeatmapTool });
})((globalThis.Colormeris ??= {}));

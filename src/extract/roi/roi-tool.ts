(function (CM) {
  'use strict';
  const {
    quantifyPanel,
    roiPanelProblem,
    createRoi,
    roiInstances,
    offsetKey,
    boxOffset,
    toBox,
    boxGeom,
    geomToBox,
    pointInPolygon,
    centroid,
    cellAt,
    roiCsv,
    roiToLocal,
    roiFromLocal,
    roiControlPoints,
    gridBoxSize,
    equalBoxGeom,
    translateGeom,
    fromBox,
    boundsOf,
    clampPoint,
    clampShift,
    fitGeom,
    setupRoiOverlay,
    setupRoiSidebar,
    scaleBarClick,
  } = CM;

  // ROI tool: quantify luminescence overlays inside drawn regions (ellipses,
  // rectangles, polygons). Colored pixels are read through the colorbar and
  // grayscale pixels (the photograph) count as no signal. With a grid, a region
  // drawn in one box is copied into every box (see roi/geometry.js).
  //
  // This file sets up the tool and handles drawing and editing regions.
  // roi-overlay.js draws over the image, roi-sidebar.js renders the cards; the
  // three share `rctx` (state, selection, colors, hit testing).


  // setupRoiTool(ws) registers the tool with a workspace (workspace/workspace.js).
  function setupRoiTool(ws) {
  const { $, app, viewer } = ws;
  const state = {
    selectedId: null, // selected region
    draft: null, // {shape, a, b, equal} while dragging a new ellipse/rect
    showMask: false,
    mask: null, // {key, canvas}
    metric: 'sum',
  };
  const selectedRoi = () => ws.activePanel().rois.find((r) => r.id === state.selectedId) || null;
  // Region colors come from the Settings dialog (colors.roiPalette), in turn.
  const roiColor = (panel, roi) => {
    const palette = ws.color('roiPalette');
    return palette[Math.max(0, panel.rois.indexOf(roi)) % palette.length];
  };
  const rctx = { ws, state, selectedRoi, roiColor, regionAt, deleteSelected };
  const { drawOverlay, drawModePreview, hoverText } = setupRoiOverlay(rctx);
  const { renderSidebar } = setupRoiSidebar(rctx);

  ws.addTool({
    kind: 'roi',
    label: 'ROI',
    title: 'Colormeris · ROI',
    computeResult: (panel, image) => quantifyPanel(image, panel),
    resultKey: (panel) => [panel.grid, panel.colorbar, panel.settings, panel.rois, panel.scale],
    panelProblem: roiPanelProblem,
    panelFiles: (panels, results, bases) =>
      panels.flatMap((p, i) => (results[i].error ? [] : [{ path: `data/${bases[i]}_rois.csv`, content: roiCsv([{ panel: p, result: results[i] }]) }])),
    hasCalibration: (p) => p.rois.length > 0 || !!p.scale,
    sections: ['sec-rois', 'sec-scale', 'sec-roi-results'],
    gridTexts: ['Click the outer top-left corner of the grid of boxes.', 'Click the outer bottom-right corner.'],
    modeTexts: {
      ellipse: ['Drag to draw an ellipse. Hold Shift for a circle.'],
      rect: ['Drag to draw a rectangle. Hold Shift for a square.'],
      polygon: (m) =>
        m.points.length < 3
          ? `Click to add points (${m.points.length} so far).`
          : 'Click the first point, double-click or press Enter to close. Backspace removes the last point.',
      scale: ['Click one end of the scale bar.', 'Click the other end. Hold Alt to disable axis snapping.'],
    },
    onModeChange,
    onClick,
    hitTest,
    onHandleDrag,
    wantsDrag: () => ws.app.mode?.type === 'ellipse' || ws.app.mode?.type === 'rect',
    onDragStart: (p, e) => {
      const lim = drawLimit(p);
      const a = clampPoint(p, lim);
      state.draft = { shape: ws.app.mode.type, a, b: a, equal: e.shiftKey, lim };
    },
    onDragMove: (p, e) => {
      if (!state.draft) return;
      state.draft.b = clampPoint(p, state.draft.lim);
      state.draft.equal = e.shiftKey;
      ws.viewer.requestDraw();
    },
    onDragEnd: finishDraft,
    drawOverlay,
    drawModePreview,
    hoverText,
    onKey,
    renderSidebar,
  });

  // ---------------------------------------------------------------- bounds
  // Regions stay inside the grid (or the image without one), and a copied
  // region stays inside its box.

  const UNIT = { x0: 0, y0: 0, x1: 1, y1: 1 };

  function gridLimit(grid) {
    if (grid.corners) return boundsOf(grid.corners);
    const img = app.imageData;
    return { x0: 0, y0: 0, x1: img.width, y1: img.height };
  }

  // Where a shape started at p may extend: its box when it will be copied
  // into every box, else the grid.
  function drawLimit(p) {
    const grid = ws.activePanel().grid;
    const lim = gridLimit(grid);
    const cell = grid.corners && $('roi-replicate').checked ? cellAt(grid, clampPoint(p, lim)) : null;
    if (!cell) return lim;
    return boundsOf([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map((q) => fromBox(grid, q, cell.row, cell.col)));
  }

  const geomBounds = (shape, geom) => boundsOf(roiControlPoints({ shape, geom }));

  // Limit for one copy's own coordinates (box coordinates minus its offset).
  function localLimit(roi, grid, row, col) {
    if (!roi.replicate) return gridLimit(grid);
    const o = boxOffset(roi, row, col);
    return { x0: -o.dx, y0: -o.dy, x1: 1 - o.dx, y1: 1 - o.dy };
  }

  // ---------------------------------------------------------------- drawing regions

  function nextRoiName(panel) {
    let n = 1;
    const used = new Set(panel.rois.map((r) => r.name));
    while (used.has(`ROI ${n}`)) n++;
    return `ROI ${n}`;
  }

  // Add a region drawn in image pixels; copy it into every box when asked.
  function placeShape(shape, geomPx) {
    const panel = ws.activePanel();
    const grid = panel.grid;
    const centre = shape === 'polygon' ? centroid(geomPx.points) : { x: geomPx.cx, y: geomPx.cy };
    let roi;
    const cell = grid.corners ? cellAt(grid, centre) : null;
    if ($('roi-replicate').checked && cell) {
      roi = createRoi(shape, fitGeom(shape, geomToBox(shape, geomPx, grid, cell.row, cell.col), UNIT), { name: nextRoiName(panel) });
    } else {
      roi = createRoi(shape, fitGeom(shape, geomPx, gridLimit(grid)), { name: nextRoiName(panel), replicate: false });
      if ($('roi-replicate').checked && grid.corners) ws.toast('Drawn outside the grid, so it was added as a single region.');
    }
    ws.setMode(null);
    ws.commit((p) => p.rois.push(roi));
    state.selectedId = roi.id;
    ws.changed();
  }

  function finishDraft(p, e) {
    const d = state.draft;
    state.draft = null;
    if (!d) return;
    const geom = boxGeom(d.a, clampPoint(p, d.lim), e.shiftKey);
    if (geom.rx < 1.5 || geom.ry < 1.5) {
      ws.toast('That region is too small; drag a larger shape.', true);
      viewer.requestDraw();
      return;
    }
    placeShape(d.shape, geom);
  }

  function closePolygon() {
    const m = app.mode;
    if (m?.type !== 'polygon') return;
    if (m.points.length < 3) {
      ws.toast('A polygon needs at least 3 points.', true);
      return;
    }
    placeShape('polygon', { points: m.points.slice() });
  }

  function onClick(mode, p, e) {
    if (mode?.type === 'polygon') {
      const tol = 8 / viewer.scale;
      const first = mode.points[0];
      if (mode.points.length >= 3 && (e.detail >= 2 || Math.hypot(p.x - first.x, p.y - first.y) <= tol)) closePolygon();
      else {
        if (!mode.points.length) mode.lim = drawLimit(p);
        mode.points.push(clampPoint(p, mode.lim));
        ws.updateModebar();
        viewer.requestDraw();
      }
      return true;
    }
    if (mode?.type === 'scale') return scaleBarClick(ws, mode, p, e);
    if (mode?.type === 'ellipse' || mode?.type === 'rect') return true; // shapes are dragged, not clicked
    if (mode) return false;
    // No tool: clicking a region selects it.
    const hit = regionAt(p);
    state.selectedId = hit ? hit.roi.id : null;
    ws.changed();
    return true;
  }

  // Topmost region copy containing p (selected region first).
  function regionAt(p) {
    const panel = ws.activePanel();
    const order = [...panel.rois].sort((a, b) => (b.id === state.selectedId) - (a.id === state.selectedId));
    for (const roi of order) {
      for (const inst of roiInstances(roi, panel.grid)) {
        if (pointInPolygon(p, inst.outline)) return { roi, row: inst.row, col: inst.col };
      }
    }
    return null;
  }

  function onModeChange(type) {
    for (const s of ['ellipse', 'rect', 'polygon']) ws.setPressed($(`tool-${s}`), type === s);
    ws.setPressed($('scale-place'), type === 'scale');
    if (type !== 'ellipse' && type !== 'rect') state.draft = null;
  }

  // ---------------------------------------------------------------- editing regions

  function hitTest(p, tol) {
    if (app.mode) return null;
    const panel = ws.activePanel();
    const sel = selectedRoi();
    if (sel) {
      for (const inst of roiInstances(sel, panel.grid)) {
        const pts = roiControlPoints(sel).map((q) => roiFromLocal(sel, panel.grid, inst.row, inst.col, q));
        const i = pts.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) <= tol);
        if (i >= 0) return { kind: sel.shape === 'polygon' ? 'roiVertex' : 'roiCorner', roiId: sel.id, row: inst.row, col: inst.col, i };
      }
    }
    const hit = regionAt(p);
    return hit ? { kind: 'roiMove', roiId: hit.roi.id, row: hit.row, col: hit.col } : null;
  }

  function onHandleDrag(handle, p, e) {
    const panel = ws.activePanel();
    const roi = panel.rois.find((r) => r.id === handle.roiId);
    if (!roi) return;
    state.selectedId = roi.id;
    const grid = panel.grid;
    if (handle.kind === 'roiMove') {
      // Remember where the drag started, in the region's box coordinates.
      if (!handle.start) {
        handle.start = roi.replicate ? toBox(grid, p, handle.row, handle.col) : p;
        handle.geom = structuredClone(roi.geom);
        handle.offset = { ...boxOffset(roi, handle.row, handle.col) };
      }
      const now = roi.replicate ? toBox(grid, p, handle.row, handle.col) : p;
      let dx = now.x - handle.start.x;
      let dy = now.y - handle.start.y;
      const b = geomBounds(roi.shape, handle.geom);
      if (roi.replicate && !e.altKey) {
        // Nudge this box's copy only.
        const o = handle.offset;
        ({ dx, dy } = clampShift({ x0: b.x0 + o.dx, y0: b.y0 + o.dy, x1: b.x1 + o.dx, y1: b.y1 + o.dy }, dx, dy, UNIT));
        roi.offsets[offsetKey(handle.row, handle.col)] = { dx: o.dx + dx, dy: o.dy + dy };
      } else {
        if (roi.replicate) {
          // Every copy moves, so the copy with the largest offset sets the limit.
          const corners = [];
          for (let row = 0; row < grid.rows; row++) {
            for (let col = 0; col < grid.cols; col++) {
              const o = row === handle.row && col === handle.col ? handle.offset : boxOffset(roi, row, col);
              corners.push({ x: b.x0 + o.dx, y: b.y0 + o.dy }, { x: b.x1 + o.dx, y: b.y1 + o.dy });
            }
          }
          ({ dx, dy } = clampShift(boundsOf(corners), dx, dy, UNIT));
        } else ({ dx, dy } = clampShift(b, dx, dy, gridLimit(grid)));
        roi.geom = translateGeom(roi.shape, handle.geom, dx, dy);
        if (roi.replicate) roi.offsets[offsetKey(handle.row, handle.col)] = handle.offset;
      }
    } else if (handle.kind === 'roiCorner') {
      const lim = localLimit(roi, grid, handle.row, handle.col);
      const q = clampPoint(roiToLocal(roi, grid, handle.row, handle.col, p), lim);
      const opposite = roiControlPoints(roi)[(handle.i + 2) % 4];
      roi.geom = e.shiftKey ? equalBoxGeom(opposite, q, roi.replicate ? gridBoxSize(grid) : { w: 1, h: 1 }) : boxGeom(opposite, q, false);
      if (e.shiftKey) roi.geom = fitGeom(roi.shape, roi.geom, lim);
      // Keep dragging whichever corner is now under the pointer.
      const pts = roiControlPoints(roi);
      handle.i = pts.reduce((best, c, i) => (Math.hypot(c.x - q.x, c.y - q.y) < Math.hypot(pts[best].x - q.x, pts[best].y - q.y) ? i : best), 0);
    } else if (handle.kind === 'roiVertex') {
      roi.geom.points[handle.i] = clampPoint(roiToLocal(roi, grid, handle.row, handle.col, p), localLimit(roi, grid, handle.row, handle.col));
    }
    ws.changed({ light: true });
  }

  function deleteSelected() {
    const roi = selectedRoi();
    if (!roi) return;
    ws.commit((p) => (p.rois = p.rois.filter((r) => r.id !== roi.id)));
    state.selectedId = null;
    ws.changed();
  }

  function onKey(e) {
    const t = e.target;
    const typing = t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.type !== 'checkbox' && t.type !== 'range';
    if (typing || e.metaKey || e.ctrlKey || !app.sourceCanvas) return false;
    const m = app.mode;
    if (m?.type === 'polygon') {
      if (e.key === 'Enter') {
        closePolygon();
        return true;
      }
      if (e.key === 'Backspace') {
        m.points.pop();
        ws.updateModebar();
        viewer.requestDraw();
        e.preventDefault();
        return true;
      }
    }
    if (!m && (e.key === 'Delete' || e.key === 'Backspace') && selectedRoi()) {
      e.preventDefault();
      deleteSelected();
      return true;
    }
    return false;
  }
  for (const shape of ['ellipse', 'rect', 'polygon']) ws.addHotkey(shape, () => toggleTool(shape), { tool: 'roi' });

  function toggleTool(type) {
    ws.setMode(app.mode?.type === type ? null : type);
  }

  // ---------------------------------------------------------------- bindings

  for (const s of ['ellipse', 'rect', 'polygon']) $(`tool-${s}`).addEventListener('click', () => toggleTool(s));

  }

  Object.assign(CM, { setupRoiTool });
})((globalThis.Colormeris ??= {}));

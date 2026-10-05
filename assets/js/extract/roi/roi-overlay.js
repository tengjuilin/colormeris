(function (CM) {
  'use strict';
  const { roiInstances, shapeOutline, boxGeom, colorbarProblem, panelClassifier, readPixel, boxLabel, roiControlPoints, roiFromLocal, metricValue, shortNumber, drawScaleBar, drawScalePreview } = CM;

  // ROI tool, DOM: what the tool draws over the image (regions with their
  // labels, edit handles, the scale bar, the signal mask, previews while
  // drawing) and the status-bar hover text. Set up by roi-tool.js.
  //
  // rctx: { ws, state, selectedRoi, roiColor, regionAt } (see roi-tool.js).
  function setupRoiOverlay(rctx) {
    const { ws, state } = rctx;

    function drawOverlay(ctx, v, panel) {
      if (state.showMask) drawMask(ctx, v, panel);
      const result = ws.resultFor(panel);
      const byInstance = new Map();
      if (!result.error) for (const r of result.rows) byInstance.set(`${r.roi.id}|${r.row},${r.col}`, r);
      ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
      ctx.textBaseline = 'bottom';
      for (const roi of panel.rois) {
        const color = rctx.roiColor(panel, roi);
        const selected = roi.id === state.selectedId;
        // All copies of a region as one path: one fill and stroke per region,
        // not per copy.
        const instances = roiInstances(roi, panel.grid);
        ctx.beginPath();
        for (const inst of instances) addPolygon(ctx, v, inst.outline);
        if (selected) {
          ctx.globalAlpha = 0.15;
          ctx.fillStyle = color;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ws.strokeDual(ctx, color, selected ? 2.5 : 1.5);
        for (const inst of instances) {
          // Label with the current metric when the copy is big enough on screen.
          const xs = inst.outline.map((q) => q.x);
          const ys = inst.outline.map((q) => q.y);
          const widthPx = (Math.max(...xs) - Math.min(...xs)) * v.scale;
          if (widthPx < 36) continue;
          const r = byInstance.get(`${roi.id}|${inst.row},${inst.col}`) || byInstance.get(`${roi.id}|null,null`);
          const value = r ? metricValue(r.stats, state.metric) : null;
          const label = value === null || value === undefined ? roi.name : `${roi.name}: ${shortNumber(value)}`;
          const s = v.toScreen({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...ys) });
          const w = ctx.measureText(label).width;
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.strokeText(label, s.x - w / 2, s.y - 3);
          ctx.fillStyle = color;
          ctx.fillText(label, s.x - w / 2, s.y - 3);
        }
      }
      const sel = rctx.selectedRoi();
      if (sel) {
        const color = rctx.roiColor(panel, sel);
        for (const inst of roiInstances(sel, panel.grid)) {
          for (const q of roiControlPoints(sel)) ws.drawHandle(ctx, v, roiFromLocal(sel, panel.grid, inst.row, inst.col, q), color, sel.shape === 'polygon' ? 'circle' : 'square');
        }
      }
      if (panel.scale) drawScaleBar(ws, ctx, v, panel.scale);
    }

    // Adds a closed polygon to the current path.
    function addPolygon(ctx, v, pts) {
      pts.forEach((q, i) => {
        const s = v.toScreen(q);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.closePath();
    }

    function drawModePreview(ctx, v, m, hover) {
      if ((m.type === 'ellipse' || m.type === 'rect') && state.draft) {
        const roi = { shape: m.type, geom: boxGeom(state.draft.a, state.draft.b, state.draft.equal) };
        ws.polyPath(ctx, v, shapeOutline(roi));
        ws.strokeDual(ctx, '#00e5ff', 1.5, [6, 4]);
      } else if (m.type === 'polygon' && m.points.length) {
        const pts = hover ? [...m.points, hover] : m.points;
        ctx.beginPath();
        pts.forEach((q, i) => {
          const s = v.toScreen(q);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ws.strokeDual(ctx, '#00e5ff', 1.5, [6, 4]);
        m.points.forEach((q, i) => ws.drawHandle(ctx, v, q, i === 0 ? '#ffd400' : '#00e5ff', 'circle'));
      } else {
        drawScalePreview(ws, ctx, v, m, hover);
      }
    }

    // Tint pixels counted as signal (magenta) and flagged colors (red).
    function drawMask(ctx, v, panel) {
      if (colorbarProblem(panel)) return;
      const img = ws.app.imageData;
      const key = JSON.stringify([ws.currentPage(), img.width, panel.colorbar, panel.settings]);
      if (state.mask?.key !== key) {
        const classify = panelClassifier(img, panel);
        const at = classify.img === img ? classify.pixel : (i) => classify(readPixel(img, i % img.width, Math.floor(i / img.width)));
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const mctx = canvas.getContext('2d');
        const out = mctx.createImageData(img.width, img.height);
        // Write whole pixels through a 32-bit view (in the platform's byte order).
        const px = new Uint32Array(out.data.buffer);
        const rgba = (...c) => new Uint32Array(new Uint8ClampedArray(c).buffer)[0];
        const flagged = rgba(255, 40, 40, 170);
        const signal = rgba(255, 0, 200, 120);
        for (let i = 0; i < px.length; i++) {
          const c = at(i);
          if (c.signal) px[i] = c.flagged ? flagged : signal;
        }
        mctx.putImageData(out, 0, 0);
        state.mask = { key, canvas };
      }
      ctx.imageSmoothingEnabled = v.scale < 2;
      ctx.drawImage(state.mask.canvas, v.ox, v.oy, img.width * v.scale, img.height * v.scale);
    }

    function hoverText(panel, cell, p) {
      const box = cell ? boxLabel(panel.grid, cell.row, cell.col) : '';
      const hit = rctx.regionAt(p);
      if (!hit) return box;
      const result = ws.resultFor(panel);
      const r = result.error ? null : result.rows.find((x) => x.roi === hit.roi && (hit.row === null || (x.row === hit.row && x.col === hit.col)));
      const where = box ? `${box} · ` : '';
      if (!r) return `${where}${hit.roi.name}`;
      const s = r.stats;
      return `${where}${hit.roi.name}: sum ${shortNumber(s.sum)} · mean ${shortNumber(s.mean)} · max ${shortNumber(s.max)} · signal ${s.signalPx}/${s.areaPx} px`;
    }

    return { drawOverlay, drawModePreview, hoverText };
  }

  Object.assign(CM, { setupRoiOverlay });
})((globalThis.Colormeris ??= {}));

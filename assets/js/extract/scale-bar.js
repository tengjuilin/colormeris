(function (CM) {
  'use strict';

  // Scale bar, DOM: measuring a scale bar on the image ('scale' mode, two
  // clicks), drawing it and its preview. Shared by the ROI tool (areas in real
  // units) and the Map tool (profile distances in real units). The Scale
  // card's buttons and fields are bound in roi/roi-sidebar.js and act on the
  // active panel, whatever the tool.

  const SCALE_COLOR = '#22d3ee';

  // A click in 'scale' mode: the first end, then the other one, which sets
  // panel.scale with the length and unit typed in the card.
  function scaleBarClick(ws, mode, p, e) {
    const { $ } = ws;
    const q = mode.points.length === 1 && !e.altKey ? ws.snapAxis(mode.points[0], p) : p;
    mode.points.push(q);
    if (mode.points.length < 2) {
      ws.updateModebar();
      return true;
    }
    const [p1, p2] = mode.points;
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 3) {
      mode.points.pop();
      ws.toast('Too short; click the other end of the scale bar.', true);
      return true;
    }
    ws.setMode(null);
    const length = Number($('scale-length').value) > 0 ? Number($('scale-length').value) : 1;
    ws.commit((pn) => (pn.scale = { p1, p2, length, unit: $('scale-unit').value }));
    $('scale-length').focus();
    $('scale-length').select();
    return true;
  }

  function drawScaleBar(ws, ctx, v, scale) {
    const a = v.toScreen(scale.p1);
    const b = v.toScreen(scale.p2);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ws.strokeDual(ctx, SCALE_COLOR, 2);
    for (const q of [scale.p1, scale.p2]) ws.drawHandle(ctx, v, q, SCALE_COLOR, 'circle');
    const label = `${scale.length} ${scale.unit}`;
    ctx.save();
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    const w = ctx.measureText(label).width;
    const mx = (a.x + b.x) / 2 - w / 2;
    const my = Math.min(a.y, b.y) - 6;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(label, mx, my);
    ctx.fillStyle = SCALE_COLOR;
    ctx.fillText(label, mx, my);
    ctx.restore();
  }

  // The dashed line from the first end to the pointer while measuring.
  function drawScalePreview(ws, ctx, v, m, hover) {
    if (m.type !== 'scale' || m.points.length !== 1 || !hover) return;
    const a = v.toScreen(m.points[0]);
    const b = v.toScreen(ws.snapAxis(m.points[0], hover));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ws.strokeDual(ctx, SCALE_COLOR, 1.5, [6, 4]);
  }

  Object.assign(CM, { scaleBarClick, drawScaleBar, drawScalePreview });
})((globalThis.Colormeris ??= {}));

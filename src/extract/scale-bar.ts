import type { Mode, Point, ScaleBar, ScaleUnit, ViewerApi, Workspace } from '../types/index.ts';

// Scale bar, DOM: measuring a scale bar on the image ('scale' mode, two
// clicks), drawing it and its preview. Shared by the ROI tool (areas in real
// units) and the Map tool (profile distances in real units). The Scale card
// (scale-bar-card.tsx, React) acts on the active panel, whatever the tool.

/** Set before the commit that adds a scale bar; the Scale card focuses its length field in the layout effect after that render. */
export const scaleFocus = { pending: false };

/** Length and unit the next measurement takes: what the Scale card last showed or had typed. */
export const scaleDefaults: { length: number; unit: ScaleUnit } = { length: 1, unit: 'cm' };

// A click in 'scale' mode: the first end, then the other one, which sets
// panel.scale with the length and unit typed in the card.
export function scaleBarClick(ws: Workspace, mode: Mode, p: Point, e: PointerEvent) {
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
  const { length, unit } = scaleDefaults;
  scaleFocus.pending = true;
  try {
    ws.commit((pn) => (pn.scale = { p1, p2, length: length > 0 ? length : 1, unit }));
  } catch (err) {
    scaleFocus.pending = false;
    throw err;
  }
  return true;
}

export function drawScaleBar(ws: Workspace, ctx: CanvasRenderingContext2D, v: ViewerApi, scale: ScaleBar) {
  const color = ws.color('scale') as string;
  const a = v.toScreen(scale.p1);
  const b = v.toScreen(scale.p2);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ws.strokeDual(ctx, color, 2);
  for (const q of [scale.p1, scale.p2]) ws.drawHandle(ctx, v, q, color, 'circle');
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
  ctx.fillStyle = color;
  ctx.fillText(label, mx, my);
  ctx.restore();
}

// The dashed line from the first end to the pointer while measuring.
export function drawScalePreview(
  ws: Workspace,
  ctx: CanvasRenderingContext2D,
  v: ViewerApi,
  m: Mode,
  hover: Point | undefined,
) {
  if (m.type !== 'scale' || m.points.length !== 1 || !hover) return;
  const a = v.toScreen(m.points[0]);
  const b = v.toScreen(ws.snapAxis(m.points[0], hover));
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ws.strokeDual(ctx, ws.color('scale') as string, 1.5, [6, 4]);
}

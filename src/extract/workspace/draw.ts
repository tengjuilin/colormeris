// Canvas helpers shared by everything drawn over the image (the workspace overlay, the heatmap, ROI and map
// tools, the scale bar): page points go through the viewer to screen pixels, lines are stroked twice (a dark
// outline under the color) so they read on light and dark figures, and labels are outlined the same way.
import type { Point, ViewerApi } from '../../types/index.ts';

/** The dark line under every colored stroke. */
const OUTLINE = 'rgba(0,0,0,0.65)';

/** Strokes the current path in `color` over a slightly wider dark outline; `dash` for previews. */
export function strokeDual(ctx: CanvasRenderingContext2D, color: string, width: number, dash?: number[]) {
  ctx.setLineDash(dash || []);
  ctx.lineWidth = width + 2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Adds the polygon through page points `pts` to the current path (or a Path2D), closed unless `close` is false. */
export function addPolygon(path: CanvasRenderingContext2D | Path2D, v: ViewerApi, pts: Point[], close = true) {
  pts.forEach((q, i) => {
    const s = v.toScreen(q);
    if (i === 0) path.moveTo(s.x, s.y);
    else path.lineTo(s.x, s.y);
  });
  if (close) path.closePath();
}

/** Starts a new path with the closed polygon through page points `pts`. */
export function polyPath(ctx: CanvasRenderingContext2D, v: ViewerApi, pts: Point[]) {
  ctx.beginPath();
  addPolygon(ctx, v, pts);
}

/** Starts a new path with the line between page points p and q. */
export function segmentPath(ctx: CanvasRenderingContext2D, v: ViewerApi, p: Point, q: Point) {
  ctx.beginPath();
  addPolygon(ctx, v, [p, q], false);
}

/** A draggable handle at page point p: a 10 px square or circle with a white rim. */
export function drawHandle(
  ctx: CanvasRenderingContext2D,
  v: ViewerApi,
  p: Point,
  color: string,
  shape: 'square' | 'circle' = 'square',
) {
  const s = v.toScreen(p);
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
  else ctx.rect(s.x - 5, s.y - 5, 10, 10);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
}

/** Text at screen point (x, y) in `color` over a 3 px dark outline; font and baseline are the caller's. */
export function outlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  outline = 'rgba(0,0,0,0.8)',
) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = outline;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

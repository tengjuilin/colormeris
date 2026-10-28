// Box and colorbar-line geometry: model boxes to page pixels, search areas, spans.

import type { Box, DecisionBox, Point, ViewFrame } from '../../types/index.ts';
import type { Axis, Span } from './types.ts';

// A box answer (fractions of the image) → page pixels. `frame` describes
// the image: page point (x0, y0) at image pixel (0, 0), `scale` image
// pixels per page pixel, `width` × `height` image pixels.
export function boxToPage(box: DecisionBox, frame: ViewFrame) {
  const f = (v: number) => Math.round(v * 10) / 10;
  return {
    x0: f(frame.x0 + (box.left * frame.width) / frame.scale),
    y0: f(frame.y0 + (box.top * frame.height) / frame.scale),
    x1: f(frame.x0 + (box.right * frame.width) / frame.scale),
    y1: f(frame.y0 + (box.bottom * frame.height) / frame.scale),
  };
}

// A box grown by `f` of its size plus `px` on every side, kept on the page.
export function growBox(b: Box, f: number, px: number, width: number, height: number) {
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  return {
    x0: Math.max(0, b.x0 - w * f - px),
    y0: Math.max(0, b.y0 - h * f - px),
    x1: Math.min(width, b.x1 + w * f + px),
    y1: Math.min(height, b.y1 + h * f + px),
  };
}

// The strip of page beside the cells where a colorbar on `side` must be,
// leaving the cells out so the box question cannot pick them.
export function besideBox(cells: Box, side: string, width: number, height: number) {
  const w = cells.x1 - cells.x0;
  const h = cells.y1 - cells.y0;
  const reachX = Math.max(80, 0.6 * w);
  const reachY = Math.max(80, 0.6 * h);
  const b =
    side === 'right'
      ? { x0: cells.x1 + 1, y0: cells.y0 - 0.25 * h, x1: cells.x1 + reachX, y1: cells.y1 + 0.25 * h }
      : side === 'left'
        ? { x0: cells.x0 - reachX, y0: cells.y0 - 0.25 * h, x1: cells.x0 - 1, y1: cells.y1 + 0.25 * h }
        : side === 'above'
          ? { x0: cells.x0 - 0.25 * w, y0: cells.y0 - reachY, x1: cells.x1 + 0.25 * w, y1: cells.y0 - 1 }
          : { x0: cells.x0 - 0.25 * w, y0: cells.y1 + 1, x1: cells.x1 + 0.25 * w, y1: cells.y1 + reachY };
  return { x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(width, b.x1), y1: Math.min(height, b.y1) };
}

// Colorbar line from the strip's box: along its long axis through the
// middle, low end first (bottom of a vertical bar, left of a horizontal
// one). Only a convention: the tick values set the direction.
export function barLine(bar: Box) {
  const mx = (bar.x0 + bar.x1) / 2;
  const my = (bar.y0 + bar.y1) / 2;
  return bar.y1 - bar.y0 >= bar.x1 - bar.x0
    ? { start: { x: mx, y: bar.y1 - 1 }, end: { x: mx, y: bar.y0 } }
    : { start: { x: bar.x0, y: my }, end: { x: bar.x1 - 1, y: my } };
}

// The LLM gives t from the top (vertical) or left (horizontal) end of the
// strip; the colorbar line may run either way. → t along start → end.
export function tFromTopLeft(start: Point, end: Point, t: number) {
  const vertical = Math.abs(end.y - start.y) >= Math.abs(end.x - start.x);
  const startFirst = vertical ? start.y <= end.y : start.x <= end.x;
  return startFirst ? t : 1 - t;
}

// A box cut to `span` along each axis (0–1 of its width or height).
export function boxToSpan(box: Box, span: Partial<Record<Axis, Span>>) {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const [c0, c1] = span.col || [0, 1];
  const [r0, r1] = span.row || [0, 1];
  return { x0: box.x0 + c0 * w, y0: box.y0 + r0 * h, x1: box.x0 + c1 * w, y1: box.y0 + r1 * h };
}

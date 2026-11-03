// What ending a viewer pointer gesture means: finishing a drawn shape,
// dropping a dragged handle, a click, or nothing (a pan or an aborted press).
//
// A cancelled pointer (pointercancel, lost capture) ends a drag like a
// release does, so the moved state becomes one undo step and app.drag is
// cleared; leaving it set froze the results, which wait for the drop. A
// cancelled press that never moved is not a click.

export type PointerEnd = 'drawEnd' | 'handleDrop' | 'click' | null;

export interface PointerEndInput {
  moved: boolean;
  draw: boolean;
  handle: unknown;
  panOnly: boolean;
}

export function pointerEnd(p: PointerEndInput, { cancelled = false, button = 0 } = {}): PointerEnd {
  if (p.draw && p.moved) return 'drawEnd';
  if (p.handle && p.moved) return 'handleDrop';
  if (!cancelled && !p.moved && !p.panOnly && button === 0) return 'click';
  return null;
}

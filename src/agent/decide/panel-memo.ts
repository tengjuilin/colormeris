// Per-panel values the decision tools keep between calls (numbered
// tick-label boxes, colorbar candidates, a trimmed grid box, unsure
// counts), each valid only while the part of the panel it was made for is
// unchanged. An undo, a set_colorbar by the LLM or a new grid makes the old
// value disappear instead of being used on a bar or grid that is gone; an
// undo back to the same bar or grid brings it back.

import type { Panel } from '../../types/index.ts';

/** What a value depends on, as a string: equal strings, same value. */
export type PanelSignature = (p: Panel) => string;

export const barSignature: PanelSignature = (p) => JSON.stringify([p.colorbar.start, p.colorbar.end]);
export const gridSignature: PanelSignature = (p) => JSON.stringify(p.grid.corners);
export const countSignature: PanelSignature = (p) => JSON.stringify([p.grid.corners, p.grid.rows, p.grid.cols]);

export function panelMemo<T>(signature: PanelSignature) {
  const byPanel = new Map<string, { sig: string; value: T }>();
  return {
    /** The value set for this panel, or undefined once what it depends on changed. */
    get(p: Panel): T | undefined {
      const e = byPanel.get(p.id);
      return e && e.sig === signature(p) ? e.value : undefined;
    },
    /** Keep a value for the panel as it is now. */
    set(p: Panel, value: T) {
      byPanel.set(p.id, { sig: signature(p), value });
    },
    delete(p: Panel) {
      byPanel.delete(p.id);
    },
  };
}

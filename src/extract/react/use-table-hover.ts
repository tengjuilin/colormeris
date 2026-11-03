// Hovering a results table marks the cell on the image: the cell under the pointer becomes app.tableCell
// (its data-r / data-c), leaving the table clears it. Shared by the heatmap and ROI Results cards.
import { type RefObject, useEffect } from 'react';
import type { WorkspaceContext } from '../../types/index.ts';

/** `cells` selects the table cells that stand for a grid cell (they carry data-r and data-c). */
export function useTableHover(w: WorkspaceContext, table: RefObject<HTMLTableElement | null>, cells = 'td[data-r]') {
  useEffect(() => {
    const el = table.current;
    if (!el) return;
    const over = (e: PointerEvent) => {
      const td = (e.target as HTMLElement).closest<HTMLElement>(cells);
      w.app.tableCell = td ? { row: Number(td.dataset.r), col: Number(td.dataset.c) } : null;
      w.viewer.requestDraw();
    };
    const leave = () => {
      w.app.tableCell = null;
      w.viewer.requestDraw();
    };
    el.addEventListener('pointerover', over);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointerover', over);
      el.removeEventListener('pointerleave', leave);
    };
  }, [w, table, cells]);
}

// A short view of a panel for tool results.

import type { PanelSnapshot } from '../../types/index.ts';

// A short view of a panel for tool results: the full snapshot (agent/
// schema.js panelSnapshot) lists every row and column label, 1.2k tokens
// for 60 rows, after every add_tick.
export function panelBrief(p: PanelSnapshot | null | undefined) {
  if (!p) return null;
  const ends = (l: string[] = []) => (l.length > 2 ? `${l[0]} … ${l[l.length - 1]}` : l.join(', '));
  const g = p.grid;
  return {
    id: p.id,
    name: p.name,
    page: p.page,
    ready: p.ready,
    problem: p.problem,
    grid: g
      ? {
          rows: g.rows,
          cols: g.cols,
          corners: g.corners,
          labels: `rows ${ends(g.rowLabels)}, columns ${ends(g.colLabels)}`,
        }
      : null,
    colorbar: { start: p.colorbar.start, end: p.colorbar.end, scale: p.colorbar.scale, ticks: p.colorbar.ticks },
  };
}

import { rgbToHex } from '../../core/color.ts';
import type { Cell, HeatmapCell, HeatmapResult, Panel, Rgb } from '../../types/index.ts';
import { effectiveLabels } from '../project/project.ts';
import { formatNumber } from '../project/project-files.ts';

// The heatmap Results card's table, built with the DOM (up to 1000 × 1000 cells, with a hover highlight
// that adds a class to one td), so the React card hosts it through a ref instead of rendering it. Also the
// cell texts the table and the status bar share.

/** Why an off-map cell has no value. */
export const OFF_MAP: Record<string, string> = {
  gray: 'gray, not on the colorbar',
  hue: 'a hue not on the colorbar',
  far: 'far from every colorbar color',
};

/** The sign of a bound: "≤" / "≥" for an open end bin. */
export const boundPrefix = (c: HeatmapCell) => (c.open === 'below' ? '≤' : c.open === 'above' ? '≥' : '');

export function luminance([r, g, b]: Rgb) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** The one-line summary under the card title, for a result without an error. */
export function heatmapSummary(res: HeatmapResult, maxDeltaE: number): string {
  // A loop, not Math.min(...values): spreading a large grid overflows the call stack.
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const row of res.cells)
    for (const { value } of row)
      if (Number.isFinite(value)) {
        lo = Math.min(lo, value);
        hi = Math.max(hi, value);
      }
  const n = res.counts;
  const flagged = n.flagged + n.offMap;
  return (
    `${res.rows} × ${res.cols} cells` +
    (lo <= hi ? ` · range ${formatNumber(lo)} – ${formatNumber(hi)}` : '') +
    (res.bins ? ` · binned colorbar (${res.bins.length} bins), bin middles` : '') +
    (n.empty ? ` · ${n.empty} without a dot (blank)` : '') +
    (n.offMap ? ` · ${n.offMap} not on the colorbar (blank)` : '') +
    (n.open ? ` · ${n.open} bounds (≤ / ≥)` : '') +
    ` · ${flagged ? `${flagged} flagged (ΔE > ${maxDeltaE} or off the colorbar) — outlined in red` : 'no flagged cells'}`
  );
}

function th(text: string, rowhead = false) {
  const el = document.createElement('th');
  el.textContent = text;
  if (rowhead) el.className = 'rowhead';
  return el;
}

/** Fill `table` with the values of `res` (or empty it for an error). */
export function fillResultTable(table: HTMLElement, panel: Panel, res: HeatmapResult | { error: string }) {
  if (!('cells' in res)) {
    table.replaceChildren();
    return;
  }
  const result = res;
  const rowLabels = effectiveLabels(panel.grid.rowLabels, result.rows, 'R');
  const colLabels = effectiveLabels(panel.grid.colLabels, result.cols, 'C');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  hr.append(th('', true), ...colLabels.map((l) => th(l)));
  thead.append(hr);
  const tbody = document.createElement('tbody');
  result.cells.forEach((row, r) => {
    const tr = document.createElement('tr');
    tr.append(th(rowLabels[r], true));
    row.forEach((c, k) => {
      const td = document.createElement('td');
      td.dataset.r = String(r);
      td.dataset.c = String(k);
      if (c.empty) {
        td.textContent = '–';
        td.title = `${rowLabels[r]} / ${colLabels[k]}\nno dot (blank)`;
        tr.append(td);
        return;
      }
      const off = c.status === 'off-map';
      td.textContent = off ? '–' : boundPrefix(c) + Number(c.value.toPrecision(4)).toString();
      td.style.background = rgbToHex(c.rgb!);
      td.style.color = luminance(c.rgb!) > 0.45 ? '#111' : '#fff';
      td.title = off
        ? `${rowLabels[r]} / ${colLabels[k]}\nno value: ${OFF_MAP[c.reason!] || 'not on the colorbar'}\nΔE ${c.deltaE.toFixed(2)}`
        : `${rowLabels[r]} / ${colLabels[k]}\nvalue ${boundPrefix(c)}${formatNumber(c.value)}${c.status === 'clamped' ? " (past the colorbar's end)" : c.open ? ' (open end bin)' : ''}\nΔE ${c.deltaE.toFixed(2)}`;
      if (c.flagged) td.classList.add('flagged');
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.replaceChildren(thead, tbody);
}

/** Mark one cell of the table (the one hovered on the image) with `hl`. */
export function highlightTableCell(table: HTMLElement | null, cell: Cell | null) {
  if (!table) return;
  table.querySelector('td.hl')?.classList.remove('hl');
  if (cell) table.querySelector(`td[data-r="${cell.row}"][data-c="${cell.col}"]`)?.classList.add('hl');
}

import { rgbToHex } from '../../core/color.ts';
import { colorAtT } from '../../core/colorbar.ts';
import { bilinear, cellSamplePolygon, outerCorners } from '../../core/grid.ts';
import type { Cell, HeatmapResult, Panel, Point, ToolHooks, ViewerApi, Workspace } from '../../types/index.ts';
import { effectiveLabels } from '../project/project.ts';
import { formatNumber, heatmapPanelFiles } from '../project/project-files.ts';
import { boundPrefix, highlightTableCell, luminance, OFF_MAP } from './results-table.ts';
import { extractPanel, panelProblem } from './sampling.ts';

// Heatmap tool: extract one value per grid cell by matching the cell's color
// against the calibrated colorbar. setupHeatmapTool(ws) registers it with a
// workspace (workspace.js). Its sidebar is React: the Grid card (shared), the Results card
// (workspace/cards/heatmap-results-card.tsx, table in results-table.ts).

export function setupHeatmapTool(ws: Workspace) {
  const { app, viewer } = ws;

  ws.addTool({
    kind: 'heatmap',
    label: 'heatmap',
    title: 'Colormeris · Heatmap',
    computeResult: (panel, image) => extractPanel(image, panel),
    resultKey: (panel) => [panel.grid, panel.colorbar, panel.settings],
    panelProblem,
    panelFiles: (panels, results, bases) => panels.flatMap((p, i) => heatmapPanelFiles(p, results[i], bases[i])),
    sections: ['sec-hm-results'],
    gridTexts: ['Click the outer top-left corner of the heatmap.', 'Click the outer bottom-right corner.'],
    drawUnderGrid,
    drawOverGrid,
    hoverText,
    onHoverCell: (cell) => {
      highlightTableCell(document.getElementById('result-table'), cell);
      viewer.requestDraw();
    },
  } satisfies ToolHooks);

  // ---------------------------------------------------------------- overlay

  // Adds a closed polygon to the current path (ws.polyPath starts a new one).
  function addPolygon(ctx: CanvasRenderingContext2D | Path2D, v: ViewerApi, pts: Point[]) {
    pts.forEach((q, i) => {
      const s = v.toScreen(q);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
  }

  // result.cells → cells grouped by the hex color of their repainted value,
  // kept per result: the colors only change with the values, but the overlay
  // redraws on every pan, zoom and hover.
  const reconColors = new WeakMap<HeatmapResult, Map<string, [number, number][]>>();
  function reconColorsFor(result: HeatmapResult) {
    let hit = reconColors.get(result);
    if (!hit) {
      const groups = (hit = new Map<string, [number, number][]>());
      result.cells.forEach((row, r) =>
        row.forEach((c, k) => {
          // Empty and off-map cells have no value to repaint.
          if (c.empty || c.status === 'off-map') return;
          const hex = rgbToHex(colorAtT(result.samples, c.t));
          if (!groups.has(hex)) groups.set(hex, []);
          groups.get(hex)!.push([r, k]);
        }),
      );
      reconColors.set(result, hit);
    }
    return hit;
  }

  // Reconstruction: repaint each sampled area with the color its value maps to,
  // one path and fill per color.
  function drawUnderGrid(ctx: CanvasRenderingContext2D, v: ViewerApi, panel: Panel, active: boolean) {
    if (!active || !app.showRecon) return;
    const result = ws.resultFor(panel) as HeatmapResult;
    if (!result.cells) return;
    const g = panel.grid;
    for (const [hex, cells] of reconColorsFor(result)) {
      ctx.beginPath();
      for (const [r, k] of cells) addPolygon(ctx, v, cellSamplePolygon(g, r, k, result.cells[r][k].radius));
      ctx.fillStyle = hex;
      ctx.fill();
    }
  }

  // Sampled areas (when cells are large enough to read) and flagged cells,
  // each kind stroked as one path.
  function drawOverGrid(ctx: CanvasRenderingContext2D, v: ViewerApi, panel: Panel, active: boolean) {
    if (!active) return;
    const g = panel.grid;
    const c = outerCorners(g);
    // With dot centers the sampled circles follow each dot's radius from the result.
    const result = ws.resultFor(panel) as Partial<HeatmapResult>;
    const radius = (r: number, k: number) => result.cells?.[r]?.[k]?.radius ?? null;
    const cellPx = Math.min(
      (Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y) / g.cols) * v.scale,
      (Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y) / g.rows) * v.scale,
    );
    if (cellPx > 10 && !app.showRecon) {
      // The outline adapts to the sampled color: dark on light cells, white on
      // dark ones. Before there is a result, white dashes over a dark line.
      const light = new Path2D();
      const dark = new Path2D();
      const unknown = new Path2D();
      for (let r = 0; r < g.rows; r++) {
        for (let k = 0; k < g.cols; k++) {
          const cell = result.cells?.[r][k];
          if (cell?.empty) continue;
          const path = !cell ? unknown : luminance(cell.rgb!) > 0.45 ? light : dark;
          addPolygon(path, v, cellSamplePolygon(g, r, k, radius(r, k)));
        }
      }
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke(unknown);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.stroke(light);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke(dark);
      ctx.stroke(unknown);
      ctx.setLineDash([]);
    }
    if (!result.cells) return;
    ctx.beginPath();
    for (let r = 0; r < g.rows; r++) {
      for (let k = 0; k < g.cols; k++) {
        if (result.cells[r][k].flagged) addPolygon(ctx, v, cellSamplePolygon(g, r, k, radius(r, k)));
      }
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = ws.COLORS.flag;
    ctx.stroke();
    // Empty cells (no dot found) get a small cross at their center.
    if (cellPx > 6) {
      ctx.beginPath();
      const s = Math.min(5, cellPx / 6);
      for (let r = 0; r < g.rows; r++) {
        for (let k = 0; k < g.cols; k++) {
          if (!result.cells[r][k].empty) continue;
          const p = v.toScreen(bilinear(c, (k + 0.5) / g.cols, (r + 0.5) / g.rows));
          ctx.moveTo(p.x - s, p.y - s);
          ctx.lineTo(p.x + s, p.y + s);
          ctx.moveTo(p.x + s, p.y - s);
          ctx.lineTo(p.x - s, p.y + s);
        }
      }
      // Dark with a white border, so it shows on the usual white background and on dark figures.
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.stroke();
    }
  }

  function hoverText(panel: Panel, cell: Cell | null) {
    if (!cell) return '';
    const rl = effectiveLabels(panel.grid.rowLabels, panel.grid.rows, 'R')[cell.row];
    const cl = effectiveLabels(panel.grid.colLabels, panel.grid.cols, 'C')[cell.col];
    const c = (ws.resultFor(panel) as Partial<HeatmapResult>).cells?.[cell.row]?.[cell.col];
    if (c?.empty) return `${rl} / ${cl}: no dot`;
    if (c?.status === 'off-map') return `${rl} / ${cl}: no value (${OFF_MAP[c.reason!] || 'not on the colorbar'})`;
    return c
      ? `${rl} / ${cl}: ${boundPrefix(c)}${formatNumber(c.value)}  (ΔE ${c.deltaE.toFixed(1)})`
      : `${rl} / ${cl}`;
  }
}

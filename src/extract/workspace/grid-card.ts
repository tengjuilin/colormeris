import { gridPixelSize } from '../../core/grid.ts';
import { parseLabelText } from '../project/project.ts';
import type { GridCardMembers, Panel, WorkspaceContext } from '../../types/index.ts';

// The Grid card: corners, rows and columns, labels. For the Map tool it is
// the Plot area card (TOOL_HOOKS plotArea): corners only.
//
// w is the workspace's private context (workspace.js). Other modules'
// functions are called through it at call time (setMode, commit, applyDetectedSize, ...).
export function setupWorkspaceGridCard(w: WorkspaceContext): GridCardMembers {
  const { $, app } = w;

  function renderGridCard(panel: Panel) {
    const g = panel.grid;
    w.setValue($('grid-rows'), g.rows);
    w.setValue($('grid-cols'), g.cols);
    if ($('grid-row-labels')) w.setValue($('grid-row-labels'), g.rowLabels.join('\n'));
    if ($('grid-col-labels')) w.setValue($('grid-col-labels'), g.colLabels.join('\n'));
    if ($('grid-box-labels')) w.setValue($('grid-box-labels'), g.boxLabels.join('\n'));
    // A plot area (Map tool) has no cells; its size in pixels is what matters.
    const plotArea = w.tool().plotArea;
    const size = g.corners && plotArea ? gridPixelSize(g.corners) : null;
    w.setBadge($('grid-state'), !g.corners ? 'not placed' : size ? `${Math.round(size.width)} × ${Math.round(size.height)} px` : `${g.rows} × ${g.cols}`, !!g.corners);
    $('grid-labels-note').textContent = g.rowLabels.length || g.colLabels.length ? 'custom' : 'R1…, C1…';
    $('grid-boxes-note').textContent = g.boxLabels.length ? `${g.boxLabels.length} names` : 'R1 C1, …';
    // ROI works without a grid, so its grid is never the next step.
    $('grid-detect').disabled = !g.corners;
    $('grid-clear').disabled = !g.corners;
    if ($('grid-read-labels')) $('grid-read-labels').disabled = !g.corners || $('grid-read-labels').dataset.busy === '1';
  }

  $('grid-place').addEventListener('click', () => w.setMode(app.mode?.type === 'grid' ? null : 'grid'));
  w.bindNumber('grid-rows', (p, v) => {
    p.grid.rows = Math.min(1000, Math.max(1, Math.round(v)));
    p.grid.autoSize = false;
  });
  w.bindNumber('grid-cols', (p, v) => {
    p.grid.cols = Math.min(1000, Math.max(1, Math.round(v)));
    p.grid.autoSize = false;
  });
  $('grid-clear').addEventListener('click', () => {
    const panel = w.activePanel();
    if (panel.rois?.some((r) => r.replicate) && !confirm('Regions copied into every box will have no copies without a grid. Remove the grid?')) return;
    w.commit((p) => (p.grid.corners = null));
  });
  $('grid-detect').addEventListener('click', () => w.commit((p) => w.applyDetectedSize(p)));
  if ($('grid-row-labels')) w.bindText('grid-row-labels', (p, v) => (p.grid.rowLabels = parseLabelText(v)));
  if ($('grid-col-labels')) w.bindText('grid-col-labels', (p, v) => (p.grid.colLabels = parseLabelText(v)));
  if ($('grid-box-labels')) w.bindText('grid-box-labels', (p, v) => (p.grid.boxLabels = parseLabelText(v)));
  for (const [id, key] of ([['grid-row-labels', 'rows'], ['grid-col-labels', 'cols']] as const).filter(([id]) => $(id))) {
    // Pasting a label list sets the matching grid dimension when the grid is still default-sized.
    $(id).addEventListener('change', () => {
      const p = w.activePanel();
      const labels = key === 'rows' ? p.grid.rowLabels : p.grid.colLabels;
      if (labels.length > 1 && labels.length !== p.grid[key] && confirm(`Set ${key} to ${labels.length} to match the labels?`)) {
        w.commit((pn) => (pn.grid[key] = labels.length));
      }
    });
  }

  return { renderGridCard };
}

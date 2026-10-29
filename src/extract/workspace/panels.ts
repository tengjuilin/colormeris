import type { Panel, PanelSettings, PanelsMembers, WorkspaceContext } from '../../types/index.ts';
import { createPanel } from '../project/project.ts';

// Panels: adding and removing panels, and the rule that every page shown has
// a panel. The Panels card itself is cards/panels-card.tsx.
//
// w is the workspace's private context (workspace.js). Other modules'
// functions are called through it at call time (setMode, changed, goToPage, ...).
export function setupWorkspacePanels(w: WorkspaceContext): PanelsMembers {
  const { app } = w;

  function isEmptyPanel(p: Panel) {
    return (
      !p.grid.corners &&
      !p.colorbar.start &&
      !p.colorbar.colormap &&
      !p.colorbar.ticks.length &&
      !p.grid.rowLabels.length &&
      !p.grid.colLabels.length &&
      !p.grid.boxLabels.length &&
      !p.rois.length &&
      !p.map.x.ticks.length &&
      !p.map.y.ticks.length &&
      !p.map.profiles.length
    );
  }

  // Every page shown gets at least one panel of the active tool to calibrate.
  function ensurePagePanel(page: number, settings?: Partial<PanelSettings>) {
    if (app.project.panels.some((p) => p.page === page && p.tool === w.tool().kind)) return;
    const panel = createPanel(nextPanelName(), page, w.tool().kind);
    settings ??= app.project.panels.find((p) => p.tool === w.tool().kind)?.settings;
    Object.assign(panel.settings, settings || w.panelDefaults(w.tool().kind));
    app.project.panels.push(panel);
  }

  function nextPanelName() {
    const used = new Set(app.project.panels.map((p) => p.name));
    let n = app.project.panels.filter((p) => p.tool === w.tool().kind).length + 1;
    while (used.has(`Panel ${n}`)) n++;
    return `Panel ${n}`;
  }

  // Add a panel to the current page, with the active panel's settings, and make it the active one.
  function addPanel() {
    w.pushHistory();
    const prev = w.activePanel();
    const panel = createPanel(nextPanelName(), w.currentPage(), w.tool().kind);
    panel.settings = { ...prev.settings };
    app.project.panels.push(panel);
    app.project.activePanelId = panel.id;
    app.tableCell = null;
    w.setMode(null);
    w.changed();
    return panel;
  }

  // Delete a panel. Every page keeps one panel, so deleting the last one on
  // its page swaps in an empty panel instead. Undo restores it.
  function removePanel(panel: Panel) {
    const here = app.project.panels.filter((p) => p.page === panel.page && p.tool === panel.tool);
    const last = here.length < 2;
    w.pushHistory();
    const i = here.indexOf(panel);
    const at = app.project.panels.indexOf(panel);
    if (last) {
      const blank = createPanel(panel.name, panel.page, panel.tool);
      blank.settings = { ...panel.settings };
      app.project.panels.splice(at, 1, blank);
      if (app.project.activePanelId === panel.id) app.project.activePanelId = blank.id;
    } else {
      app.project.panels.splice(at, 1);
      if (app.project.activePanelId === panel.id) app.project.activePanelId = here[i === 0 ? 1 : i - 1].id;
    }
    w.setMode(null);
    w.changed();
    return { cleared: last };
  }

  return { addPanel, removePanel, isEmptyPanel, ensurePagePanel };
}

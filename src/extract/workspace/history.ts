import type { AppState, HistoryMembers, Panel, WorkspaceContext } from '../../types/index.ts';

// Undo and redo: snapshots of every panel, taken before each change.
//
// w is the workspace's private context (workspace.js). Other modules'
// functions are called through it at call time (setTool, goToPage, ensurePagePanel, changed).
export function setupWorkspaceHistory(w: WorkspaceContext): HistoryMembers {
  const { $, app } = w;

  function snapshot(): AppState['history'][number] {
    return structuredClone({ panels: app.project.panels, activePanelId: app.project.activePanelId });
  }

  function pushHistory() {
    app.history.push(snapshot());
    if (app.history.length > 200) app.history.shift();
    app.future = [];
  }

  function restore(snap: AppState['history'][number]) {
    app.project.panels = snap.panels;
    app.project.activePanelId = snap.activePanelId;
    // Undoing a change made on another page takes you back to that page.
    const target = app.project.panels.find((p) => p.id === snap.activePanelId);
    if (target && target.tool !== w.tool().kind) {
      w.setTool(target.tool, { quiet: true });
      if (target.page !== w.currentPage()) {
        w.goToPage(target.page, { keepActive: true });
        return;
      }
      app.project.activePanelId = target.id;
    }
    if (target && target.page !== w.currentPage()) {
      w.goToPage(target.page, { keepActive: true });
      return;
    }
    w.ensurePagePanel(w.currentPage());
    w.changed();
  }

  // Move between two history stacks. The saved counterpart keeps the panel of
  // the change being undone/redone as active, so both directions land on the
  // page where the change was made.
  function step(from: AppState['history'], to: AppState['history']) {
    if (!from.length) return;
    const snap = from.pop()!;
    const current = snapshot();
    current.activePanelId = snap.activePanelId;
    to.push(current);
    restore(snap);
  }

  // Opening a file or re-rendering at another resolution starts a new history.
  function clearHistory() {
    app.history = [];
    app.future = [];
  }

  const undo = () => step(app.history, app.future);
  const redo = () => step(app.future, app.history);

  // Apply a mutation with an undo point.
  function commit(fn: (panel: Panel) => unknown) {
    pushHistory();
    fn(w.activePanel());
    w.changed();
  }

  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);

  return { pushHistory, clearHistory, undo, redo, commit };
}

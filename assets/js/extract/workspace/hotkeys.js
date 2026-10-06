(function (CM) {
  'use strict';
  const { comboFromEvent, findHotkey, isMacPlatform } = CM;
  const isMac = isMacPlatform(globalThis.navigator);

  // View tools (zoom, crosshair, overlay) and keyboard shortcuts.
  //
  // w is the workspace's private context (workspace.js). Other modules'
  // functions are called through it at call time (setMode, undo, goToPage, ...).
  function setupWorkspaceHotkeys(w) {
    const { $, app } = w;

    $('mode-done').addEventListener('click', () => w.setMode(null));
    $('zoom-in').addEventListener('click', () => w.viewer.zoomBy(1.25));
    $('zoom-out').addEventListener('click', () => w.viewer.zoomBy(0.8));
    $('zoom-fit').addEventListener('click', () => w.viewer.fit());
    // The crosshair choice is a per-browser convenience; storage may be unavailable.
    function setCrosshair(on) {
      w.viewer.crosshair = on;
      w.setPressed($('toggle-crosshair'), on);
      try {
        localStorage.setItem('colormeris.crosshair', on ? '1' : '0');
      } catch {}
      w.viewer.requestDraw();
    }
    try {
      if (localStorage.getItem('colormeris.crosshair') === '1') setCrosshair(true);
    } catch {}
    $('toggle-crosshair').addEventListener('click', () => setCrosshair(!w.viewer.crosshair));
    $('toggle-overlay').addEventListener('click', () => {
      app.showOverlay = !app.showOverlay;
      w.setPressed($('toggle-overlay'), app.showOverlay);
      w.viewer.requestDraw();
    });

    // Keyboard shortcuts. The keys come from the Settings dialog (ws.settings.hotkeys);
    // Escape always cancels, and the ROI tool handles its polygon keys in onKey.
    const hotkeys = {};
    function addHotkey(id, run, { always = false, tool: only = null } = {}) {
      hotkeys[id] = { run, always, tool: only };
    }
    addHotkey('undo', w.undo, { always: true });
    addHotkey('redo', w.redo, { always: true });
    addHotkey('grid', () => w.setMode(app.mode?.type === 'grid' ? null : 'grid'));
    addHotkey('colorbar', () => $('bar-place').click());
    addHotkey('ticks', () => w.setMode(app.mode?.type === 'tick' ? null : 'tick'));
    addHotkey('fit', () => w.viewer.fit());
    addHotkey('zoomIn', () => w.viewer.zoomBy(1.25));
    addHotkey('zoomOut', () => w.viewer.zoomBy(0.8));
    addHotkey('crosshair', () => setCrosshair(!w.viewer.crosshair));
    // Pages flip only when there are several (the page controls are shown).
    // A page takes a moment to render and currentPage() only changes when it
    // is shown, so a key pressed meanwhile counts from the page already asked
    // for (← right after → must not compute from the old page and do nothing).
    // Flips run one after the other so the last key wins.
    let wantedPage = null;
    let flipping = Promise.resolve();
    function flipPage(step) {
      if ($('pdf-controls').hidden) return false;
      const last = app.project.source?.pageCount || 1;
      const target = Math.min(last, Math.max(1, (wantedPage ?? w.currentPage()) + step));
      wantedPage = target;
      flipping = flipping.then(() => w.goToPage(target)).finally(() => {
        if (wantedPage === target) wantedPage = null;
      });
    }
    addHotkey('prevPage', () => flipPage(-1));
    addHotkey('nextPage', () => flipPage(1));

    window.addEventListener('keydown', (e) => {
      // A modal (the Settings dialog) takes the keyboard.
      if (e.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (w.tool().onKey?.(e)) return;
      const t = e.target;
      const typing = t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.type !== 'checkbox' && t.type !== 'range';
      if (e.key === 'Escape') {
        if (typing) t.blur();
        else w.setMode(null);
        return;
      }
      if (typing) return;
      // Actions of other tools may share the key, so look only at this tool's.
      const h = hotkeys[findHotkey(w.ws.settings.hotkeys, comboFromEvent(e, isMac), w.tool().kind)];
      if (!h || (!h.always && !app.sourceCanvas) || (h.tool && h.tool !== w.tool().kind)) return;
      // A hotkey that returns false did nothing, so the browser keeps the key
      // (Mod+C with no profile selected still copies selected text).
      if (h.run() !== false) e.preventDefault();
    });

    return { addHotkey };
  }

  Object.assign(CM, { setupWorkspaceHotkeys });
})((globalThis.Colormeris ??= {}));

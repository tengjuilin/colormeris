import type {
  AppState,
  ColorValue,
  DomEl,
  ModeTexts,
  OverlayColors,
  Panel,
  PanelResult,
  PanelSettings,
  Point,
  SettingsSource,
  ToolHooks,
  ToolKind,
  ViewerApi,
  Workspace,
  WorkspaceContext,
  WorkspaceCore,
} from '../../types/index.ts';
import { createProject } from '../project/project.ts';
import { mountCards } from '../react/mount-cards.tsx';
import { COLOR_DEFAULTS, defaultSettings } from '../settings/settings.ts';
import { Viewer } from '../viewer.ts';
import { setupWorkspaceTickFocus } from './cards/tick-focus.ts';
import { setupWorkspaceExport } from './export.ts';
import { setupWorkspaceHistory } from './history.ts';
import { setupWorkspaceHotkeys } from './hotkeys.ts';
import { setupWorkspaceInteract } from './interact.ts';
import { setupWorkspaceOverlay } from './overlay.ts';
import { setupWorkspacePanels } from './panels.ts';
import { setupWorkspaceSource } from './source.ts';
import { notify } from './store.ts';

// Shared workspace for the Colormeris tools (extract.html): source loading
// and PDF pages, the zoomable viewer, panels, the grid and colorbar
// calibration, undo, keyboard shortcuts and project zips. Tools
// (heatmap/heatmap-tool.js, roi/roi-tool.js, map/map-tool.js) register with
// addTool and plug in their results and overlay through the hooks in
// TOOL_HOOKS. One project holds the panels of every tool (panel.tool); the
// active tool (setTool) shows and edits its own panels, and a project zip
// carries the data of all tools.
//
// TOOL_HOOKS (all optional unless noted):
//   kind                      'heatmap' | 'roi' | 'map' (required)
//   title                     page title while the tool is active
//   computeResult(panel, img) result object or {error} (required)
//   resultKey(panel)          JSON-able key of everything computeResult depends on
//   panelProblem(panel)       what is missing before results, or null (required)
//   panelFiles(panels, results, bases) → [{path, content}] data files for the zip
//   hasCalibration(panel)     extra test for unsaved work
//   sections                  ids of tool sidebar cards shown once a file is loaded
//   renderSidebar(panel, light)
//   modeTexts                 {mode: [texts by clicks so far] | (mode) => text}
//   onModeChange(type)
//   onClick(mode, p, e)       return true when handled
//   hitTest(p, tol)           tool handles, checked after the shared ones
//   onHandleDrag(handle, p, e) / onHandleDrop(handle)
//   wantsDrag(), onDragStart(p, e), onDragMove(p, e), onDragEnd(p, e)
//   drawUnderGrid / drawOverGrid (ctx, v, panel, active)
//   drawOverlay(ctx, v, active, panelsOnPage)
//   drawModePreview(ctx, v, mode, hover)
//   hoverText(panel, cell, p) text for the status bar
//   onHoverCell(cell)
//   onKey(e)                  return true when handled (hotkeys are added with ws.addHotkey)
//   gridTexts                 mode texts for placing the grid
//   plotArea                  true when the grid is one plot area (map/map-tool.js):
//                             no size detection, inner lines or cell highlight
//
// This file holds the state, modes, sidebar rendering and tool switching,
// and builds the public `ws` object used by tools, the agent and settings.
// The rest lives in workspace/*.js, each set up with the private context
// `w`, which collects every module's functions. Modules call each other
// through `w` at call time (w.changed(), w.goToPage(...)), so the order in
// which they are set up does not matter for calls.
//   history.js        undo/redo, commit
//   overlay.js        drawing grids, colorbars, handles
//   interact.js       clicks, handle drags, hover
//   cards/colorbar-card.tsx  the Colorbar card (React; cards/tick-focus.ts holds focusTick)
//   panels.js         the Panels card; every page has a panel
//   source.js         opening files and zips, pages, resolution, zoom box
//   export.js         downloads and the project zip
//   hotkeys.js        view tools and keyboard shortcuts
// The script tags in extract.html load these before this file.
export function createWorkspace(): Workspace {
  const $ = (id: string) => document.getElementById(id) as unknown as DomEl;
  const tools: Partial<Record<ToolKind, ToolHooks>> = {};
  let tool: ToolHooks = null as unknown as ToolHooks; // the active tool; set by setTool before anything reads it
  const toolFor = (panel: Panel) => tools[panel.tool] || tool;

  // Overlay colors come from the Settings dialog (settings.colors); `color`
  // reads them at draw time, so a change shows on the next redraw.
  const color = (id: string): ColorValue => ws.settings?.colors?.[id] ?? COLOR_DEFAULTS[id];
  const COLORS: OverlayColors = {
    get grid() {
      return color('grid') as string;
    },
    get bar() {
      return color('bar') as string;
    },
    get flag() {
      return color('flag') as string;
    },
    get highlight() {
      return color('highlight') as string;
    },
    outline: 'rgba(0,0,0,0.65)',
  };

  const app: AppState = {
    project: createProject(),
    sourceCanvas: null,
    imageData: null,
    originalFile: null,
    pdfDoc: null,
    mode: null, // {type: 'grid' | 'colorbar' | 'tick', points: []}
    cache: new Map(), // panel id → {key, result}
    pages: new Map(), // page number → {canvas, imageData} of rendered pages
    lastActive: new Map(), // `${tool}|${page}` → id of the panel last active there
    history: [],
    future: [],
    drag: null,
    hoverCell: null,
    tableCell: null,
    showOverlay: true,
    keepRect: true,
    showRecon: false,
  };

  let tickSeq = 1;
  const newTickId = () => `t${tickSeq++}`;

  const currentPage = () => app.project.source?.page || 1;
  // Panels belonging to the page on screen; only these are drawn and edited.
  const pagePanels = () => app.project.panels.filter((p) => p.page === currentPage() && p.tool === tool.kind);
  const activeKey = (page = currentPage()) => `${tool.kind}|${page}`;
  const activePanel = (): Panel => {
    const here = pagePanels();
    return here.find((p) => p.id === app.project.activePanelId) || here[0] || app.project.panels[0];
  };

  // Extract a panel from the image of its own page.
  function resultFor(panel: Panel): PanelResult {
    if (!app.sourceCanvas) return { error: 'Load a file first.' };
    const image = app.pages.get(panel.page)?.imageData;
    if (!image) return { error: `Page ${panel.page} is not rendered yet.` };
    const t = toolFor(panel);
    const key = JSON.stringify([
      panel.page,
      panel.tool,
      t.resultKey ? t.resultKey(panel) : [panel.grid, panel.colorbar, panel.settings],
    ]);
    const hit = app.cache.get(panel.id);
    if (hit && hit.key === key) return hit.result;
    const result = t.computeResult(panel, image);
    app.cache.set(panel.id, { key, result });
    return result;
  }

  // ---------------------------------------------------------------- modes

  const MODE_TEXT: Record<string, string[]> = {
    grid: ['Click the outer top-left corner of the grid.', 'Click the outer bottom-right corner.'],
    colorbar: [
      'Click one end of the colorbar (middle of the bar).',
      'Click the other end. Hold Alt to disable axis snapping.',
    ],
    tick: ['Click a labelled tick on the colorbar, then type its value. Press Done when finished.'],
  };
  const CENTER_TEXTS = ['Click the center of the top-left dot.', 'Click the center of the bottom-right dot.'];
  const modeTexts = (type: string): ModeTexts | undefined =>
    tool.modeTexts?.[type] ||
    (type === 'grid' && activePanel().grid.anchor === 'centers' && CENTER_TEXTS) ||
    (type === 'grid' && tool.gridTexts) ||
    MODE_TEXT[type];

  // `notify: false` is for setTool only: a render queued before the tool switches would run against the new
  // tool's panel (a card of the old tool computing its result for a panel of another tool).
  function setMode(type: string | null, { notify: notifyCards = true }: { notify?: boolean } = {}) {
    if (type && !app.sourceCanvas) return;
    if (type === 'tick') {
      const cb = activePanel().colorbar;
      if (!cb.start || !cb.end) {
        toast('Place the colorbar ends first.', true);
        return;
      }
    }
    app.mode = type ? { type, points: [] } : null;
    updateModebar();
    tool.onModeChange?.(type);
    viewer.requestDraw();
    // Light: nearly every caller follows with changed(), whose full notify renders once.
    if (notifyCards) notify({ light: true });
  }

  function updateModebar() {
    const m = app.mode;
    $('modebar').hidden = !m;
    if (!m) return;
    const texts = modeTexts(m.type);
    $('modebar-text').textContent =
      typeof texts === 'function' ? texts(m) : texts![Math.min(m.points.length, texts!.length - 1)];
    $('mode-done').textContent = m.type === 'tick' || m.done ? 'Done' : 'Cancel';
  }

  // ---------------------------------------------------------------- sidebar rendering

  function setValue(el: DomEl, value: string | number) {
    if (document.activeElement !== el && el.value !== String(value)) el.value = String(value);
  }

  const changeListeners: (() => void)[] = [];
  function changed({ light = false } = {}) {
    viewer.requestDraw();
    renderSidebar(light);
    for (const fn of changeListeners) fn();
  }

  // The DOM render, then React is told (store.ts) so migrated cards follow.
  function renderSidebar(light = false) {
    renderSidebarDom(light);
    notify({ light });
  }

  let helpLoaded: boolean | null = null;
  function renderSidebarDom(light: boolean) {
    const loaded = !!app.sourceCanvas;
    for (const t of Object.values(tools)) for (const id of t.sections || []) $(id).hidden = true;
    for (const id of ['sec-panels', 'sec-grid', 'sec-colorbar', ...(tool.sections || [])]) $(id).hidden = !loaded;
    $('empty-state').hidden = loaded;
    // Open the help when nothing is loaded, close it once a file is; only on the change, so a manual toggle sticks.
    if (helpLoaded !== loaded) {
      helpLoaded = loaded;
      const help = document.querySelector<HTMLDetailsElement>('details.help');
      if (help) help.open = !loaded;
    }
    // The agent card needs a file; its tool (data-tool) still decides where it shows.
    $('sec-agent').hidden = !loaded || $('sec-agent').dataset.tool !== tool.kind;
    $('view-tools').hidden = !loaded;
    $('btn-export-zip').disabled = !loaded;
    $('btn-undo').disabled = !app.history.length;
    $('btn-redo').disabled = !app.future.length;
    if (!loaded) return;

    const panel = activePanel();
    tool.renderSidebar?.(panel, light);
  }

  function setBadge(el: HTMLElement, text: string, ok: boolean) {
    el.textContent = text;
    el.className = `badge ${ok ? 'ok' : 'todo'}`;
  }

  // Toggle buttons and chips: .active for the look, aria-pressed for screen readers.
  function setPressed(el: Element, on: boolean) {
    el.classList.toggle('active', on);
    el.setAttribute('aria-pressed', String(on));
  }

  // ---------------------------------------------------------------- misc UI

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function toast(msg: string, isError = false) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('error', isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), isError ? 5000 : 3000);
  }

  function status(msg: string) {
    $('status-msg').textContent = msg;
  }

  function zoomToPoints(points: Point[]) {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const pad = 20;
    viewer.zoomTo(Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad);
  }

  function bindNumber(id: string, apply: (panel: Panel, value: number) => void) {
    const el = $(id);
    el.addEventListener('focus', () => w.pushHistory());
    el.addEventListener('input', () => {
      const v = Number(el.value);
      if (el.value === '' || !Number.isFinite(v)) return;
      apply(activePanel(), v);
      changed({ light: true });
    });
    el.addEventListener('change', () => changed());
  }

  function bindText(id: string, apply: (panel: Panel, value: string) => void) {
    const el = $(id);
    el.addEventListener('focus', () => w.pushHistory());
    el.addEventListener('input', () => {
      apply(activePanel(), el.value);
      changed({ light: true });
    });
    el.addEventListener('change', () => changed());
  }

  // Matching settings live in the Settings dialog (settings-dialog.js). They
  // are defaults for new panels and, when changed there, apply to every panel
  // of the tool. Panels keep their own copy, so a project zip reproduces its values.
  const panelDefaults = (kind: ToolKind): Partial<PanelSettings> => ({ ...ws.settings.matching[kind] });
  function applyMatching(kind: ToolKind, settings: Partial<PanelSettings>) {
    const panels = app.project.panels.filter((p) => p.tool === kind);
    const same = (p: Panel) =>
      Object.entries(settings).every(([k, v]) => (p.settings as unknown as Record<string, unknown>)[k] === v);
    if (!panels.length || panels.every(same)) return;
    w.pushHistory();
    for (const p of panels) Object.assign(p.settings, settings);
    changed();
  }

  // ---------------------------------------------------------------- tools

  function addTool(config: ToolHooks) {
    tools[config.kind] = config;
  }

  // Make another tool active. The loaded file, pages and all panels stay; the
  // tool shows its own panels on the current page (creating one if needed).
  function setTool(kind: ToolKind, { quiet = false }: { quiet?: boolean } = {}) {
    if (!tools[kind] || tool?.kind === kind) return;
    if (tool) {
      setMode(null, { notify: false });
      if (app.sourceCanvas) {
        app.lastActive.set(activeKey(), activePanel()?.id);
        // Drop the old tool's untouched placeholder panels on this page.
        const kept = app.project.panels.filter(
          (p) => !(p.tool === tool.kind && p.page === currentPage() && w.isEmptyPanel(p)),
        );
        if (kept.length) app.project.panels = kept;
      }
    }
    tool = tools[kind]!;
    // data-tool may name several tools, e.g. "heatmap roi".
    for (const el of document.querySelectorAll<HTMLElement>('[data-tool]'))
      el.hidden = !el.dataset.tool!.split(' ').includes(kind);
    for (const a of document.querySelectorAll<HTMLElement>('[data-tool-link]')) {
      if (a.dataset.toolLink === kind) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    if (tool.title) document.title = tool.title;
    // Keep the URL (#heatmap / #roi / #map) in step, e.g. when undo switches tools.
    if (location.hash !== `#${kind}`) history.replaceState(null, '', `#${kind}`);
    app.tableCell = null;
    app.hoverCell = null;
    if (app.sourceCanvas) {
      w.ensurePagePanel(currentPage());
      const remembered = app.lastActive.get(activeKey());
      app.project.activePanelId = pagePanels().some((p) => p.id === remembered) ? remembered! : pagePanels()[0].id;
    }
    notify({ light: true }); // after `tool` and the active panel are switched; changed() below renders in full
    if (!quiet) changed();
  }

  // ---------------------------------------------------------------- modules

  // Private context of the workspace modules; each setup adds its functions.
  const core: WorkspaceCore = {
    $,
    app,
    tools,
    COLORS,
    color,
    tool: () => tool,
    toolFor,
    newTickId,
    currentPage,
    pagePanels,
    activeKey,
    activePanel,
    resultFor,
    setMode,
    updateModebar,
    changed,
    setValue,
    setBadge,
    setPressed,
    toast,
    status,
    zoomToPoints,
    bindNumber,
    bindText,
    panelDefaults,
    setTool,
    ws: null as unknown as Workspace, // the public object, set below
    viewer: null as unknown as ViewerApi, // set below
  };
  const w = core as WorkspaceContext;

  // Callbacks look up w when called, as the modules below define them.
  const viewer = new Viewer($('viewer'), {
    onClick: (p, e) => w.onClick(p, e),
    hitTest: (p, tol) => w.hitTest(p, tol),
    onHandleDrag: (handle, p, e) => w.onHandleDrag(handle, p, e),
    onHandleDrop: (handle) => w.onHandleDrop(handle),
    onHover: (p) => w.onHover(p),
    drawOverlay: (ctx, v) => {
      w.drawOverlay(ctx, v);
      w.showZoom(v);
    },
    wantsLoupe: () => !!app.mode,
    handlePoint: (handle, p) => w.handlePoint(handle, p),
    wantsDrag: () => !!tool.wantsDrag?.(),
    onDragStart: (p, e) => tool.onDragStart?.(p, e),
    onDragMove: (p, e) => tool.onDragMove?.(p, e),
    onDragEnd: (p, e) => tool.onDragEnd?.(p, e),
  });
  w.viewer = viewer;

  for (const setup of [
    setupWorkspaceHistory,
    setupWorkspaceOverlay,
    setupWorkspaceInteract,
    setupWorkspaceTickFocus,
    setupWorkspacePanels,
    setupWorkspaceSource,
    setupWorkspaceExport,
    setupWorkspaceHotkeys,
  ])
    Object.assign(w, setup(w));

  const ws: Workspace = {
    addTool,
    setTool,
    tool: () => tool,
    app,
    $,
    COLORS,
    color,
    viewer,
    activePanel,
    pagePanels,
    currentPage,
    commit: w.commit,
    pushHistory: w.pushHistory,
    changed,
    setMode,
    updateModebar,
    resultFor,
    toast,
    status,
    download: w.download,
    csvName: w.csvName,
    zoomToPoints,
    bindNumber,
    bindText,
    setValue,
    setBadge,
    setPressed,
    strokeDual: w.strokeDual,
    polyPath: w.polyPath,
    drawHandle: w.drawHandle,
    snapAxis: w.snapAxis,
    render: () => renderSidebar(),
    mountCards: (settings: SettingsSource) => mountCards({ ws, w }, settings),
    // Used by the agent API (agent/api.js).
    openFile: w.openFile,
    goToPage: w.goToPage,
    undo: w.undo,
    redo: w.redo,
    canUndo: () => app.history.length > 0,
    canRedo: () => app.future.length > 0,
    exportZip: w.exportZip,
    newTickId,
    removePanel: w.removePanel,
    addHotkey: w.addHotkey,
    applyMatching,
    // App settings; replaced by settings-dialog.js with the stored ones.
    settings: defaultSettings(),
    zipExtras: [], // functions returning [{path, content}] added to project zips
    onChange: (fn) => {
      changeListeners.push(fn);
    },
    reviewStatus: null, // (panel) → 'accepted' | 'rejected' | 'stale' | null, set by agent/api.js
  };
  w.ws = ws;
  return ws;
}

// Below 820px the document scrolls; above it only inner panes do. Widening
// would leave the document scrolled with no scrollbar, hiding the whole page.
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    if (window.innerWidth > 820 && window.scrollY) window.scrollTo(0, 0);
  });
}

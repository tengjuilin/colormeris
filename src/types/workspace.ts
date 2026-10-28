// The extract.html workspace (extract/workspace/*): the public `ws` object
// that tools, the agent and the settings dialog use, the private context `w`
// shared by the workspace modules, and the hooks a tool registers with
// ws.addTool. Each setup module returns its members; WorkspaceContext is the
// core built in workspace.ts plus all of them.

import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Box, PixelImage, Point } from './image.ts';
import type { Panel, PanelSettings, Project, ReviewStatus, ToolKind } from './project.ts';
import type { PanelResult } from './results.ts';
import type { ColorValue, Settings } from './settings.ts';

/**
 * What `$` returns. Sidebar code reads value, checked, options and max on
 * elements by id, so an element is typed as an input and a select at once
 * instead of casting at every call. Other element kinds need a cast.
 */
export type DomEl = HTMLInputElement & HTMLSelectElement;

/** A placing or drawing mode: shared 'grid' | 'colorbar' | 'tick', tool modes such as 'scale', 'ellipse', 'xtick', 'profile'. */
export interface Mode {
  type: string;
  /** Points clicked so far. */
  points: Point[];
  /** The mode bar shows Done instead of Cancel (map-tool.ts). */
  done?: boolean;
  /** Drawing limit of an ROI polygon (roi-tool.ts drawLimit). */
  lim?: Box;
  [key: string]: unknown;
}

/**
 * A draggable handle from hitTest. Shared kinds: 'corner' (i), 'barStart',
 * 'barEnd', 'bar' (last), 'tick' (id); tools add their own ('roiVertex',
 * 'profileEnd', …). Drags cache state on the handle (dir, ts, len, from).
 */
export interface Handle {
  kind: string;
  i?: number;
  id?: string;
  last?: Point;
  dir?: Point;
  ts?: number[];
  len?: number;
  from?: Point[];
  roiId?: string;
  row?: number | null;
  col?: number | null;
  end?: 'a' | 'b';
  [key: string]: unknown;
}

/** A grid cell, row and column 0-based. */
export interface Cell {
  row: number;
  col: number;
}

/** A rendered page: its canvas and pixels. */
export interface PageImage {
  canvas: HTMLCanvasElement;
  imageData: ImageData;
}

/** A file in a project zip, e.g. a data CSV. */
export interface ZipFile {
  path: string;
  content: string | Blob;
}

/** Workspace state (`app`). Arrays and maps are replaced as well as mutated. */
export interface AppState {
  project: Project;
  sourceCanvas: HTMLCanvasElement | null;
  imageData: ImageData | null;
  originalFile: File | Blob | null;
  pdfDoc: PDFDocumentProxy | null;
  mode: Mode | null;
  /** Panel id → {key, result} (resultFor). */
  cache: Map<string, { key: string; result: PanelResult }>;
  /** Page number → rendered page. */
  pages: Map<number, PageImage>;
  /** `${tool}|${page}` → id of the panel last active there. */
  lastActive: Map<string, string | undefined>;
  /** Undo snapshots: structured clones of the panels and the active id. */
  history: { panels: Panel[]; activePanelId: string }[];
  future: { panels: Panel[]; activePanelId: string }[];
  drag: Handle | null;
  hoverCell: Cell | null;
  /** Cell picked in a results table, highlighted on the image. */
  tableCell: Cell | null;
  showOverlay: boolean;
}

/** Callbacks the Viewer gets from the workspace (extract/viewer.ts). */
export interface ViewerCallbacks {
  onClick?: (p: Point, e: PointerEvent) => void;
  hitTest?: (p: Point, tol: number) => Handle | null;
  onHandleDrag?: (handle: Handle, p: Point, e: PointerEvent) => void;
  onHandleDrop?: (handle: Handle) => void;
  onHover?: (p: Point | null) => void;
  drawOverlay?: (ctx: CanvasRenderingContext2D, v: ViewerApi) => void;
  wantsLoupe?: () => boolean;
  handlePoint?: (handle: Handle, p: Point) => Point | null | undefined;
  wantsDrag?: () => boolean;
  onDragStart?: (p: Point, e: PointerEvent) => void;
  onDragMove?: (p: Point, e: PointerEvent) => void;
  onDragEnd?: (p: Point, e: PointerEvent) => void;
}

/**
 * The parts of the Viewer class that other modules use. The class in
 * extract/viewer.ts must implement it (`class Viewer implements ViewerApi`);
 * it lives here so the types do not depend on that file.
 */
export interface ViewerApi {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  source: HTMLCanvasElement | null;
  /** Screen pixels per image pixel. */
  scale: number;
  ox: number;
  oy: number;
  /** Pointer over the canvas: screen point and image point. */
  hover: { sx: number; sy: number; img: Point } | null;
  crosshair: boolean;
  setSource(canvas: HTMLCanvasElement, opts?: { keepView?: boolean }): void;
  fit(): void;
  zoomBy(factor: number, sx?: number, sy?: number): void;
  zoomTo(x0: number, y0: number, x1: number, y1: number): void;
  toImage(sx: number, sy: number): Point;
  toScreen(p: Point): Point;
  requestDraw(): void;
  /** Draws now (requestDraw waits for the next frame). */
  draw(): void;
}

/** Mode bar texts: one per click so far, or a function of the mode. */
export type ModeTexts = string[] | ((mode: Mode) => string);

/**
 * What a tool registers with ws.addTool (TOOL_HOOKS in workspace.ts). All
 * optional except kind, computeResult and panelProblem.
 */
export interface ToolHooks {
  kind: ToolKind;
  /** Short name, e.g. 'ROI'. */
  label?: string;
  /** Page title while the tool is active. */
  title?: string;
  computeResult: (panel: Panel, image: ImageData | PixelImage) => PanelResult;
  /** JSON-able key of everything computeResult depends on. */
  resultKey?: (panel: Panel) => unknown;
  /** What is missing before results, or null. */
  panelProblem: (panel: Panel) => string | null;
  /** Data files for the project zip, one result and base name per panel. */
  panelFiles?: (panels: Panel[], results: PanelResult[], bases: string[]) => ZipFile[];
  /** Extra test for unsaved work. */
  hasCalibration?: (panel: Panel) => boolean;
  /** Ids of the tool's sidebar cards, shown once a file is loaded. */
  sections?: string[];
  renderSidebar?: (panel: Panel, light: boolean) => void;
  modeTexts?: Record<string, ModeTexts>;
  onModeChange?: (type: string | null) => void;
  /** Return true when handled. */
  onClick?: (mode: Mode | null, p: Point, e: PointerEvent) => boolean | undefined;
  /** Tool handles, checked after the shared ones. */
  hitTest?: (p: Point, tol: number) => Handle | null;
  onHandleDrag?: (handle: Handle, p: Point, e: PointerEvent) => void;
  onHandleDrop?: (handle: Handle) => void;
  wantsDrag?: () => boolean;
  onDragStart?: (p: Point, e: PointerEvent) => void;
  onDragMove?: (p: Point, e: PointerEvent) => void;
  onDragEnd?: (p: Point, e: PointerEvent) => void;
  drawUnderGrid?: (ctx: CanvasRenderingContext2D, v: ViewerApi, panel: Panel, active: boolean) => void;
  drawOverGrid?: (ctx: CanvasRenderingContext2D, v: ViewerApi, panel: Panel, active: boolean) => void;
  /** Called with the active panel and the panels on the page (tools may ignore the last). */
  drawOverlay?: (ctx: CanvasRenderingContext2D, v: ViewerApi, active: Panel, panelsOnPage: Panel[]) => void;
  drawModePreview?: (ctx: CanvasRenderingContext2D, v: ViewerApi, mode: Mode, hover: Point | undefined) => void;
  /** Status bar text for the hovered point. */
  hoverText?: (panel: Panel, cell: Cell | null, p: Point) => string | null | undefined;
  onHoverCell?: (cell: Cell | null) => void;
  /** Return true when handled (hotkeys are added with ws.addHotkey). */
  onKey?: (e: KeyboardEvent) => boolean | undefined;
  /** Mode texts for placing the grid. */
  gridTexts?: string[];
  /** The grid is one plot area (map tool): no size detection, inner lines or cell highlight. */
  plotArea?: boolean;
}

/** Overlay colors read at draw time from the settings. */
export interface OverlayColors {
  readonly grid: string;
  readonly bar: string;
  readonly flag: string;
  readonly highlight: string;
  outline: string;
}

/** Options of ws.addHotkey: `always` runs before a file is open; `tool` limits it to one tool. */
export interface HotkeyOptions {
  always?: boolean;
  tool?: ToolKind | null;
}

/** Options of goToPage: keep the active panel instead of the one last active on the page. */
export interface GoToPageOptions {
  keepActive?: boolean;
}

/**
 * The private context `w` of the workspace modules. workspace.ts builds the
 * core members below; each setup module adds its own (see the *Members types)
 * and calls the others through `w` at call time.
 */
export interface WorkspaceContext {
  // ---- core (workspace.ts)
  $: (id: string) => DomEl;
  app: AppState;
  tools: Partial<Record<ToolKind, ToolHooks>>;
  COLORS: OverlayColors;
  color: (id: string) => ColorValue;
  /** The active tool. */
  tool: () => ToolHooks;
  /** The panel's own tool, else the active one. */
  toolFor: (panel: Panel) => ToolHooks;
  newTickId: () => string;
  currentPage: () => number;
  pagePanels: () => Panel[];
  activeKey: (page?: number) => string;
  activePanel: () => Panel;
  resultFor: (panel: Panel) => PanelResult;
  setMode: (type: string | null) => void;
  updateModebar: () => void;
  changed: (opts?: { light?: boolean }) => void;
  setValue: (el: DomEl, value: string | number) => void;
  setBadge: (el: HTMLElement, text: string, ok: boolean) => void;
  setPressed: (el: Element, on: boolean) => void;
  toast: (msg: string, isError?: boolean) => void;
  status: (msg: string) => void;
  zoomToPoints: (points: Point[]) => void;
  bindNumber: (id: string, apply: (panel: Panel, value: number) => void) => void;
  bindText: (id: string, apply: (panel: Panel, value: string) => void) => void;
  panelDefaults: (kind: ToolKind) => Partial<PanelSettings>;
  setTool: (kind: ToolKind, opts?: { quiet?: boolean }) => void;
  viewer: ViewerApi;
  /** The public object, assigned at the end of createWorkspace (start it with a cast). */
  ws: Workspace;

  // ---- history.ts
  pushHistory: () => void;
  clearHistory: () => void;
  undo: () => void;
  redo: () => void;
  /** Push history, run fn on the active panel, then changed(). */
  commit: (fn: (panel: Panel) => unknown) => void;

  // ---- overlay.ts
  strokeDual: (ctx: CanvasRenderingContext2D, color: string, width: number, dash?: number[]) => void;
  polyPath: (ctx: CanvasRenderingContext2D, v: ViewerApi, pts: Point[]) => void;
  drawHandle: (ctx: CanvasRenderingContext2D, v: ViewerApi, p: Point, color: string, shape?: string) => void;
  drawOverlay: (ctx: CanvasRenderingContext2D, v: ViewerApi) => void;

  // ---- interact.ts
  onClick: (p: Point, e: PointerEvent) => void;
  hitTest: (p: Point, tol: number) => Handle | null;
  onHandleDrag: (handle: Handle, p: Point, e: PointerEvent) => void;
  onHandleDrop: (handle: Handle) => void;
  onHover: (p: Point | null) => void;
  handlePoint: (handle: Handle, p: Point) => Point | null | undefined;
  applyDetectedSize: (panel: Panel, opts?: { onlyIfChanged?: boolean }) => void;
  /** b moved onto the horizontal or vertical through a when within a few degrees. */
  snapAxis: (a: Point, b: Point) => Point;

  // ---- grid-card.ts
  renderGridCard: (panel: Panel) => void;

  // ---- colorbar-card.ts
  renderColorbarCard: (panel: Panel) => void;
  focusTick: (id: string) => void;

  // ---- panels.ts
  renderPanels: (active: Panel) => void;
  removePanel: (panel: Panel) => { cleared: boolean };
  isEmptyPanel: (panel: Panel) => boolean;
  ensurePagePanel: (page: number, settings?: Partial<PanelSettings>) => void;

  // ---- source.ts
  openFile: (file: File | null | undefined) => Promise<void>;
  hasCalibration: () => boolean;
  ensurePage: (page: number) => Promise<PageImage | null | undefined>;
  showZoom: (v: ViewerApi) => void;
  goToPage: (page: number, opts?: GoToPageOptions) => Promise<void>;

  // ---- export.ts
  download: (blob: Blob, name: string) => void;
  csvName: (panel: Panel, suffix?: string) => string;
  exportZip: () => Promise<void>;

  // ---- hotkeys.ts
  /** A hotkey action; `run` returning false leaves the key to the browser. */
  addHotkey: (id: string, run: () => unknown, opts?: HotkeyOptions) => void;
}

/** Members each setup module returns: `function setupWorkspaceHistory(w: WorkspaceContext): HistoryMembers`. */
export type HistoryMembers = Pick<WorkspaceContext, 'pushHistory' | 'clearHistory' | 'undo' | 'redo' | 'commit'>;
export type OverlayMembers = Pick<WorkspaceContext, 'strokeDual' | 'polyPath' | 'drawHandle' | 'drawOverlay'>;
export type InteractMembers = Pick<
  WorkspaceContext,
  'onClick' | 'hitTest' | 'onHandleDrag' | 'onHandleDrop' | 'onHover' | 'handlePoint' | 'applyDetectedSize' | 'snapAxis'
>;
export type GridCardMembers = Pick<WorkspaceContext, 'renderGridCard'>;
export type ColorbarCardMembers = Pick<WorkspaceContext, 'renderColorbarCard' | 'focusTick'>;
export type PanelsMembers = Pick<WorkspaceContext, 'renderPanels' | 'removePanel' | 'isEmptyPanel' | 'ensurePagePanel'>;
export type SourceMembers = Pick<
  WorkspaceContext,
  'openFile' | 'hasCalibration' | 'ensurePage' | 'showZoom' | 'goToPage'
>;
export type ExportMembers = Pick<WorkspaceContext, 'download' | 'csvName' | 'exportZip'>;
export type HotkeysMembers = Pick<WorkspaceContext, 'addHotkey'>;

/** The members workspace.ts builds itself, before the setup modules run. */
export type WorkspaceCore = Omit<
  WorkspaceContext,
  | keyof HistoryMembers
  | keyof OverlayMembers
  | keyof InteractMembers
  | keyof GridCardMembers
  | keyof ColorbarCardMembers
  | keyof PanelsMembers
  | keyof SourceMembers
  | keyof ExportMembers
  | keyof HotkeysMembers
>;

/**
 * The public workspace `ws` used by tools, the agent (agent/api.ts) and the
 * settings dialog. Some fields are replaced after creation: settings by
 * settings-dialog.ts, reviewStatus by agent/api.ts, and zipExtras grows.
 */
export interface Workspace {
  addTool: (config: ToolHooks) => void;
  setTool: WorkspaceContext['setTool'];
  tool: () => ToolHooks;
  app: AppState;
  $: WorkspaceContext['$'];
  COLORS: OverlayColors;
  color: WorkspaceContext['color'];
  viewer: ViewerApi;
  activePanel: () => Panel;
  pagePanels: () => Panel[];
  currentPage: () => number;
  commit: WorkspaceContext['commit'];
  pushHistory: () => void;
  changed: WorkspaceContext['changed'];
  setMode: WorkspaceContext['setMode'];
  updateModebar: () => void;
  resultFor: WorkspaceContext['resultFor'];
  toast: WorkspaceContext['toast'];
  status: WorkspaceContext['status'];
  download: WorkspaceContext['download'];
  csvName: WorkspaceContext['csvName'];
  zoomToPoints: WorkspaceContext['zoomToPoints'];
  bindNumber: WorkspaceContext['bindNumber'];
  bindText: WorkspaceContext['bindText'];
  setValue: WorkspaceContext['setValue'];
  setBadge: WorkspaceContext['setBadge'];
  setPressed: WorkspaceContext['setPressed'];
  strokeDual: WorkspaceContext['strokeDual'];
  polyPath: WorkspaceContext['polyPath'];
  drawHandle: WorkspaceContext['drawHandle'];
  snapAxis: WorkspaceContext['snapAxis'];
  /** Full sidebar render. */
  render: () => void;
  // Used by the agent API.
  openFile: WorkspaceContext['openFile'];
  goToPage: WorkspaceContext['goToPage'];
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  exportZip: () => Promise<void>;
  newTickId: () => string;
  removePanel: WorkspaceContext['removePanel'];
  addHotkey: WorkspaceContext['addHotkey'];
  /** Apply matching settings from the Settings dialog to every panel of a tool. */
  applyMatching: (kind: ToolKind, settings: Partial<PanelSettings>) => void;
  /** App settings; replaced by settings-dialog.ts with the stored ones. */
  settings: Settings;
  /** Functions returning files added to project zips (agent logs). */
  zipExtras: (() => ZipFile[])[];
  onChange: (fn: () => void) => void;
  /** Set by agent/api.ts; null until then. */
  reviewStatus: ((panel: Panel) => ReviewStatus | null) | null;
}

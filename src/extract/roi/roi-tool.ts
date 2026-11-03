import { cellAt } from '../../core/grid.ts';
import type {
  Box,
  Grid,
  Handle,
  Mode,
  Panel,
  PanelResult,
  PixelImage,
  Point,
  PolygonGeom,
  Roi,
  RoiGeom,
  RoiModeType,
  RoiOffset,
  RoiShape,
  RoiStats,
  ShapeGeom,
  ToolHooks,
  Workspace,
} from '../../types/index.ts';
import { nextName } from '../edit-math.ts';
import { createRoi, gridGeometry } from '../project/project.ts';
import { roiCsv } from '../project/project-files.ts';
import { SCALE_MODE_TEXTS, scaleBarClick } from '../scale-bar.ts';
import { isTextEntry } from '../typing.ts';
import { setRoiContext } from './cards/roi-context.ts';
import {
  boundsOf,
  boxGeom,
  boxOffset,
  centroid,
  clampPoint,
  clampShift,
  createInstanceCache,
  dragRegion,
  equalBoxGeom,
  fitGeom,
  fromBox,
  geomToBox,
  gridBoxSize,
  offsetKey,
  pointInPolygon,
  type RoiInstance,
  roiControlPoints,
  roiFromLocal,
  roiToLocal,
  toBox,
  translateGeom,
} from './geometry.ts';
import { quantifyPanel, roiPanelProblem } from './quantify.ts';
import { setupRoiOverlay } from './roi-overlay.ts';

/** A region copy found by regionAt: row and col are null for an unreplicated region. */
export interface RegionHit {
  roi: Roi;
  row: number | null;
  col: number | null;
}

/** Shape being dragged out: corners a and b, equal for a circle or square, lim the area it may cover. */
export interface RoiDraft {
  shape: RoiShape;
  a: Point;
  b: Point;
  equal: boolean;
  lim: Box;
}

export interface RoiToolState {
  /** Selected region. */
  selectedId: string | null;
  /** While dragging a new ellipse or rectangle. */
  draft: RoiDraft | null;
  showMask: boolean;
  /** "Copy new regions into every grid box". */
  replicate: boolean;
  mask: { key: string; img: ImageData; canvas: HTMLCanvasElement } | null;
  metric: keyof RoiStats;
}

/** What roi-tool.ts shares with roi-overlay.ts and the cards (cards/roi-context.ts). */
export interface RoiToolContext {
  ws: Workspace;
  state: RoiToolState;
  selectedRoi: () => Roi | null;
  roiColor: (panel: Panel, roi: Roi) => string;
  regionAt: (p: Point) => RegionHit | null;
  /** Every copy of a region with its outline (roiInstances), cached while the region and the grid are unchanged. */
  instances: (roi: Roi, grid: Grid) => RoiInstance[];
  deleteSelected: () => void;
  toggleTool: (type: RoiModeType) => void;
}

// ROI tool: quantify luminescence overlays inside drawn regions (ellipses,
// rectangles, polygons). Colored pixels are read through the colorbar and
// grayscale pixels (the photograph) count as no signal. With a grid, a region
// drawn in one box is copied into every box (see roi/geometry.ts).
//
// This file sets up the tool and handles drawing and editing regions.
// roi-overlay.ts draws over the image, the cards (roi/cards/, React) are the
// sidebar; all share `rctx` (state, selection, colors, hit testing).

// setupRoiTool(ws) registers the tool with a workspace (workspace/workspace.ts).
export function setupRoiTool(ws: Workspace) {
  const { app, viewer } = ws;
  const state: RoiToolState = {
    selectedId: null, // selected region
    draft: null, // {shape, a, b, equal} while dragging a new ellipse/rect
    showMask: false,
    replicate: true,
    mask: null, // {key, img, canvas}
    metric: 'sum',
  };
  const selectedRoi = () => ws.activePanel().rois.find((r) => r.id === state.selectedId) || null;
  // Region colors come from the Settings dialog (colors.roiPalette), in turn.
  const roiColor = (panel: Panel, roi: Roi) => {
    const palette = ws.color('roiPalette') as string[];
    return palette[Math.max(0, panel.rois.indexOf(roi)) % palette.length];
  };
  const instances = createInstanceCache();
  const rctx: RoiToolContext = { ws, state, selectedRoi, roiColor, regionAt, instances, deleteSelected, toggleTool };
  const { drawOverlay, drawModePreview, hoverText } = setupRoiOverlay(rctx);
  setRoiContext(rctx);

  // While a handle is dragged (a region, a corner, the colorbar) the labels, hover text and table keep the
  // last numbers: quantifying every region on each pointer move cost more than a frame. resultKey has the drag
  // in it, so the drop quantifies once.
  const lastResult = new Map<string, { image: ImageData | PixelImage; result: PanelResult }>();
  function computeResult(panel: Panel, image: ImageData | PixelImage): PanelResult {
    const last = lastResult.get(panel.id);
    if (app.drag && last?.image === image) return last.result;
    const result = quantifyPanel(image, panel);
    lastResult.set(panel.id, { image, result });
    return result;
  }

  ws.addTool({
    kind: 'roi',
    label: 'ROI',
    title: 'Colormeris · ROI',
    computeResult,
    resultKey: (panel) => [
      gridGeometry(panel.grid),
      panel.colorbar,
      panel.settings,
      panel.rois,
      panel.scale,
      !!app.drag,
    ],
    panelProblem: roiPanelProblem,
    panelFiles: (panels, results, bases) =>
      panels.flatMap((p, i) =>
        results[i].error
          ? []
          : [{ path: `data/${bases[i]}_rois.csv`, content: roiCsv([{ panel: p, result: results[i] }]) }],
      ),
    hasCalibration: (p) => p.rois.length > 0 || !!p.scale,
    sections: ['sec-rois', 'sec-scale', 'sec-roi-results'],
    gridTexts: ['Click the outer top-left corner of the grid of boxes.', 'Click the outer bottom-right corner.'],
    modeTexts: {
      ellipse: ['Drag to draw an ellipse. Hold Shift for a circle.'],
      rect: ['Drag to draw a rectangle. Hold Shift for a square.'],
      polygon: (m) =>
        m.points.length < 3
          ? `Click to add points (${m.points.length} so far).`
          : 'Click the first point, double-click or press Enter to close. Backspace removes the last point.',
      scale: SCALE_MODE_TEXTS,
    },
    onModeChange,
    onClick,
    hitTest,
    onHandleDrag,
    wantsDrag: () => ws.app.mode?.type === 'ellipse' || ws.app.mode?.type === 'rect',
    onDragStart: (p, e) => {
      const lim = drawLimit(p);
      const a = clampPoint(p, lim);
      state.draft = { shape: ws.app.mode!.type as RoiShape, a, b: a, equal: e.shiftKey, lim };
    },
    onDragMove: (p, e) => {
      if (!state.draft) return;
      state.draft.b = clampPoint(p, state.draft.lim);
      state.draft.equal = e.shiftKey;
      ws.viewer.requestDraw();
    },
    onDragEnd: finishDraft,
    drawOverlay,
    drawModePreview,
    hoverText,
    onKey,
    // The cards render themselves; this only drops a selection that no longer exists (undo, panel switch).
    reconcile: (p) => {
      if (!p.rois.some((r) => r.id === state.selectedId)) state.selectedId = null;
    },
  } satisfies ToolHooks);

  // ---------------------------------------------------------------- bounds
  // Regions stay inside the grid (or the image without one), and a copied
  // region stays inside its box.

  const UNIT = { x0: 0, y0: 0, x1: 1, y1: 1 };

  function gridLimit(grid: Grid): Box {
    if (grid.corners) return boundsOf(grid.corners);
    const img = app.imageData!;
    return { x0: 0, y0: 0, x1: img.width, y1: img.height };
  }

  // Where a shape started at p may extend: its box when it will be copied
  // into every box, else the grid.
  function drawLimit(p: Point) {
    const grid = ws.activePanel().grid;
    const lim = gridLimit(grid);
    const cell = grid.corners && state.replicate ? cellAt(grid, clampPoint(p, lim)) : null;
    if (!cell) return lim;
    return boundsOf(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ].map((q) => fromBox(grid, q, cell.row, cell.col)),
    );
  }

  // Limit for one copy's own coordinates (box coordinates minus its offset).
  function localLimit(roi: Roi, grid: Grid, row: number, col: number) {
    if (!roi.replicate) return gridLimit(grid);
    const o = boxOffset(roi, row, col);
    return { x0: -o.dx, y0: -o.dy, x1: 1 - o.dx, y1: 1 - o.dy };
  }

  // ---------------------------------------------------------------- drawing regions

  // Add a region drawn in image pixels; copy it into every box when asked.
  function placeShape(shape: RoiShape, geomPx: RoiGeom) {
    const panel = ws.activePanel();
    const grid = panel.grid;
    const centre =
      shape === 'polygon'
        ? centroid((geomPx as PolygonGeom).points)
        : { x: (geomPx as ShapeGeom).cx, y: (geomPx as ShapeGeom).cy };
    let roi: Roi;
    const cell = grid.corners ? cellAt(grid, centre) : null;
    if (state.replicate && cell) {
      roi = createRoi(shape, fitGeom(shape, geomToBox(shape, geomPx, grid, cell.row, cell.col), UNIT), {
        name: nextName(
          'ROI',
          panel.rois.map((r) => r.name),
        ),
      });
    } else {
      roi = createRoi(shape, fitGeom(shape, geomPx, gridLimit(grid)), {
        name: nextName(
          'ROI',
          panel.rois.map((r) => r.name),
        ),
        replicate: false,
      });
      if (state.replicate && grid.corners) ws.toast('Drawn outside the grid, so it was added as a single region.');
    }
    ws.setMode(null);
    ws.commit((p) => p.rois.push(roi));
    state.selectedId = roi.id;
    ws.changed();
  }

  function finishDraft(p: Point, e: PointerEvent) {
    const d = state.draft;
    state.draft = null;
    if (!d) return;
    const geom = boxGeom(d.a, clampPoint(p, d.lim), e.shiftKey);
    if (geom.rx < 1.5 || geom.ry < 1.5) {
      ws.toast('That region is too small; drag a larger shape.', true);
      viewer.requestDraw();
      return;
    }
    placeShape(d.shape, geom);
  }

  function closePolygon() {
    const m = app.mode;
    if (m?.type !== 'polygon') return;
    if (m.points.length < 3) {
      ws.toast('A polygon needs at least 3 points.', true);
      return;
    }
    placeShape('polygon', { points: m.points.slice() });
  }

  function onClick(mode: Mode | null, p: Point, e: PointerEvent) {
    if (mode?.type === 'polygon') {
      const tol = 8 / viewer.scale;
      const first = mode.points[0];
      if (mode.points.length >= 3 && (e.detail >= 2 || Math.hypot(p.x - first.x, p.y - first.y) <= tol)) closePolygon();
      else {
        if (!mode.points.length) mode.lim = drawLimit(p);
        mode.points.push(clampPoint(p, mode.lim!));
        ws.updateModebar();
        viewer.requestDraw();
      }
      return true;
    }
    if (mode?.type === 'scale') return scaleBarClick(ws, mode, p, e);
    if (mode?.type === 'ellipse' || mode?.type === 'rect') return true; // shapes are dragged, not clicked
    if (mode) return false;
    // No tool: clicking a region selects it.
    const hit = regionAt(p);
    state.selectedId = hit ? hit.roi.id : null;
    ws.changed();
    return true;
  }

  // Topmost region copy containing p (selected region first).
  function regionAt(p: Point): RegionHit | null {
    const panel = ws.activePanel();
    const order = [...panel.rois].sort((a, b) => Number(b.id === state.selectedId) - Number(a.id === state.selectedId));
    for (const roi of order) {
      for (const inst of instances(roi, panel.grid)) {
        if (pointInPolygon(p, inst.outline)) return { roi, row: inst.row, col: inst.col };
      }
    }
    return null;
  }

  function onModeChange(type: string | null) {
    if (type !== 'ellipse' && type !== 'rect') state.draft = null;
  }

  // ---------------------------------------------------------------- editing regions

  function hitTest(p: Point, tol: number): Handle | null {
    if (app.mode) return null;
    const panel = ws.activePanel();
    const sel = selectedRoi();
    if (sel) {
      for (const inst of instances(sel, panel.grid)) {
        const pts = roiControlPoints(sel).map((q) => roiFromLocal(sel, panel.grid, inst.row!, inst.col!, q));
        const i = pts.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) <= tol);
        if (i >= 0)
          return {
            kind: sel.shape === 'polygon' ? 'roiVertex' : 'roiCorner',
            roiId: sel.id,
            row: inst.row,
            col: inst.col,
            i,
          };
      }
    }
    const hit = regionAt(p);
    return hit ? { kind: 'roiMove', roiId: hit.roi.id, row: hit.row, col: hit.col } : null;
  }

  function onHandleDrag(h: Handle, p: Point, e: PointerEvent) {
    if (h.kind !== 'roiMove' && h.kind !== 'roiCorner' && h.kind !== 'roiVertex') return;
    const handle = h;
    const panel = ws.activePanel();
    const roi = panel.rois.find((r) => r.id === handle.roiId);
    if (!roi) return;
    state.selectedId = roi.id;
    const grid = panel.grid;
    // A single region's handle has null row and col; the helpers read them only for a replicated region.
    const row = handle.row!;
    const col = handle.col!;
    if (handle.kind === 'roiMove') {
      // Remember where the drag started, in the region's box coordinates.
      if (!handle.start) {
        handle.start = roi.replicate ? toBox(grid, p, row, col) : p;
        handle.geom = structuredClone(roi.geom);
        handle.offset = { ...boxOffset(roi, row, col) };
      }
      const now = roi.replicate ? toBox(grid, p, row, col) : p;
      // Alt moves every copy of a replicated region; without it only this box's copy is nudged.
      const moved = dragRegion(
        roi,
        grid,
        handle.row,
        handle.col,
        handle.geom!,
        handle.offset!,
        now.x - handle.start.x,
        now.y - handle.start.y,
        { nudge: !e.altKey, limit: gridLimit(grid) },
      );
      if (moved.geom) roi.geom = moved.geom;
      if (moved.offset) roi.offsets[offsetKey(row, col)] = moved.offset;
    } else if (handle.kind === 'roiCorner') {
      const lim = localLimit(roi, grid, row, col);
      const q = clampPoint(roiToLocal(roi, grid, row, col, p), lim);
      const opposite = roiControlPoints(roi)[(handle.i! + 2) % 4];
      roi.geom = e.shiftKey
        ? equalBoxGeom(opposite, q, roi.replicate ? gridBoxSize(grid) : { w: 1, h: 1 })
        : boxGeom(opposite, q, false);
      if (e.shiftKey) roi.geom = fitGeom(roi.shape, roi.geom, lim);
      // Keep dragging whichever corner is now under the pointer.
      const pts = roiControlPoints(roi);
      handle.i = pts.reduce(
        (best, c, i) =>
          Math.hypot(c.x - q.x, c.y - q.y) < Math.hypot(pts[best].x - q.x, pts[best].y - q.y) ? i : best,
        0,
      );
    } else {
      (roi.geom as PolygonGeom).points[handle.i!] = clampPoint(
        roiToLocal(roi, grid, row, col, p),
        localLimit(roi, grid, row, col),
      );
    }
    ws.changed({ light: true });
  }

  function deleteSelected() {
    const roi = selectedRoi();
    if (!roi) return;
    ws.commit((p) => (p.rois = p.rois.filter((r) => r.id !== roi.id)));
    state.selectedId = null;
    ws.changed();
  }

  function onKey(e: KeyboardEvent) {
    if (isTextEntry(e.target) || e.metaKey || e.ctrlKey || !app.sourceCanvas) return false;
    const m = app.mode;
    if (m?.type === 'polygon') {
      if (e.key === 'Enter') {
        closePolygon();
        return true;
      }
      if (e.key === 'Backspace') {
        m.points.pop();
        ws.updateModebar();
        viewer.requestDraw();
        e.preventDefault();
        return true;
      }
    }
    if (!m && (e.key === 'Delete' || e.key === 'Backspace') && selectedRoi()) {
      e.preventDefault();
      deleteSelected();
      return true;
    }
    return false;
  }
  for (const shape of ['ellipse', 'rect', 'polygon'] as const)
    ws.addHotkey(shape, () => toggleTool(shape), { tool: 'roi' });

  // Also called by the Regions card's buttons.
  function toggleTool(type: RoiModeType) {
    ws.setMode(app.mode?.type === type ? null : type);
  }
}

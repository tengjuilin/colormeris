// The ROI Regions card: draw toggles (E / R / P), the copy-into-every-box option, one chip per region (keyed by
// region id) and, for the selected region, its name, Reset nudges and Delete. Read in render, write in handlers
// (docs/react.md §10). The selection lives in the tool state (roi-tool.ts); Delete / Backspace is its onKey.
import type { Panel, Roi } from '../../../types/index.ts';
import { Actions, BoundInput, Btn, CardHead, Check, Chip, ChipList, Field, SplitActions } from '../../../ui/index.ts';
import { useBoundText } from '../../react/use-bound.ts';
import { useWorkspace } from '../../react/use-workspace.ts';
import { notify } from '../../workspace/store.ts';
import { useRoiContext } from './roi-context.ts';

const SHAPE_NAMES: Record<string, string> = { ellipse: 'Ellipse', rect: 'Rectangle', polygon: 'Polygon' };

/** The chip's meta text: copies in the grid and how many are nudged. */
export function roiMeta(panel: Panel, roi: Roi): string {
  if (!roi.replicate) return 'single';
  const copies = panel.grid.corners ? panel.grid.rows * panel.grid.cols : 0;
  const nudged = Object.keys(roi.offsets).length;
  return `×${copies}${nudged ? `, ${nudged} nudged` : ''}`;
}

export function RegionsCard() {
  const { w } = useWorkspace({ section: 'sec-rois' });
  const rctx = useRoiContext();
  const { ws, state } = rctx;
  const { app } = w;
  const panel = w.activePanel();
  // A selection that no longer exists (deleted, undone, other panel) selects nothing.
  const sel = panel.rois.find((r) => r.id === state.selectedId) ?? null;
  const n = panel.rois.length;
  const mode = app.mode?.type;

  const rename = useBoundText((p, value) => {
    const roi = p.rois.find((r) => r.id === state.selectedId);
    if (roi) roi.name = value;
  });

  function draw(shape: string, label: string, title: string) {
    return (
      <Btn
        id={`tool-${shape}`}
        hotkey={shape}
        title={title}
        pressed={mode === shape}
        onClick={() => rctx.toggleTool(shape)}
      >
        <span className={`shape-icon ${shape}`} aria-hidden="true" />
        {label}
      </Btn>
    );
  }

  return (
    <>
      <CardHead
        title={
          <>
            <span className="step-dot roi-dot" />
            Regions
          </>
        }
        badge={{ id: 'roi-state', text: n ? `${n} region${n === 1 ? '' : 's'}` : 'none', ok: n > 0 }}
      />
      <SplitActions role="toolbar" aria-label="Draw a region">
        {draw('ellipse', 'Ellipse', 'Ellipse ({key}) — hold Shift for a circle')}
        {draw('rect', 'Rectangle', 'Rectangle ({key}) — hold Shift for a square')}
        {draw('polygon', 'Polygon', 'Polygon ({key}) — click points, then click the first point or press Enter')}
      </SplitActions>
      <Check
        id="roi-replicate"
        label="Copy new regions into every grid box"
        checked={state.replicate}
        onChange={(on) => {
          // Read when the next region is drawn; nothing to redraw.
          state.replicate = on;
          notify({ light: true });
        }}
      />
      <ChipList id="roi-list">
        {panel.rois.map((roi) => (
          <Chip
            key={roi.id}
            className="roi-item"
            pressed={roi.id === state.selectedId}
            icon={
              <span
                className={`shape-icon ${roi.shape}`}
                style={{ '--roi-color': rctx.roiColor(panel, roi) } as never}
              />
            }
            meta={roiMeta(panel, roi)}
            title={`${SHAPE_NAMES[roi.shape]}${roi.replicate ? ' copied into every box' : ''}`}
            onClick={() => {
              state.selectedId = roi.id === state.selectedId ? null : roi.id;
              ws.changed();
            }}
          >
            {roi.name}
          </Chip>
        ))}
      </ChipList>
      <div id="roi-edit" hidden={!sel}>
        <Field
          label="Region name"
          title="Drag a copy to nudge it in its box; Alt-drag moves all copies. Handles resize the shape everywhere."
        >
          <BoundInput key={sel?.id} id="roi-name" spellCheck={false} value={sel?.name ?? ''} {...rename} />
        </Field>
        <Actions>
          <Btn
            id="roi-reset"
            icon="reset"
            title="Put every copy back at the shared position"
            disabled={!sel?.replicate || !Object.keys(sel.offsets).length}
            onClick={() => {
              const roi = rctx.selectedRoi();
              if (roi) ws.commit((p) => (p.rois.find((r) => r.id === roi.id)!.offsets = {}));
            }}
          >
            Reset nudges
          </Btn>
          <Btn
            id="roi-delete"
            variant="danger"
            icon="trash"
            title="Delete (Delete or Backspace; ⌫ on a Mac)"
            onClick={() => rctx.deleteSelected()}
          >
            Delete
          </Btn>
        </Actions>
      </div>
    </>
  );
}

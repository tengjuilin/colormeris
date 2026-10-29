// The Grid card, shared by the three tools: corners, rows and columns, labels (grid-labels.tsx) and sampling
// options for heatmaps; box names for ROI. For the Map tool it is the Plot area card (the tool's `plotArea`):
// corners only, with its size in pixels. Fields that belong to one tool are hidden, not unmounted, so the
// ids stay in the DOM and the Options open state survives a tool switch. Read in render, write in handlers
// (docs/react.md §10).
import { cornerCellCenters, gridPixelSize, outerCorners } from '../../../core/grid.ts';
import type { GridAnchor, GridShape } from '../../../types/index.ts';
import {
  BoundInput,
  BoundSelect,
  CardHead,
  Check,
  Field,
  Fields,
  IconBtn,
  MainStep,
  Options,
} from '../../../ui/index.ts';
import { ANCHOR_DEFAULTS } from '../../project/project.ts';
import { useBoundNumber } from '../../react/use-bound.ts';
import { useWorkspace } from '../../react/use-workspace.ts';
import { notify } from '../store.ts';
import { DetectButton } from './grid-detect.tsx';
import { BoxNameOptions, LabelOptions } from './grid-labels.tsx';

const clampCount = (v: number) => Math.min(1000, Math.max(1, Math.round(v)));

const ANCHOR_TITLE =
  "Outer corners: click the grid's outer top-left and bottom-right corners (heatmaps). Dot centers: click the centers of the top-left and bottom-right dots (dot plots without cell borders); each dot is sampled inside its own radius and cells without a dot are left blank.";

export function GridCard() {
  const { w } = useWorkspace({ section: 'sec-grid' });
  const { app } = w;
  const tool = w.tool();
  const heatmap = tool.kind === 'heatmap';
  const roi = tool.kind === 'roi';
  const plotArea = !!tool.plotArea;
  const panel = w.activePanel();
  const g = panel.grid;
  const dots = g.anchor === 'centers';
  // A plot area has no cells; its size in pixels is what matters.
  const size = g.corners && plotArea ? gridPixelSize(g.corners) : null;
  const badge = !g.corners
    ? 'not placed'
    : size
      ? `${Math.round(size.width)} × ${Math.round(size.height)} px`
      : `${g.rows} × ${g.cols}`;
  const placeLabel = plotArea ? 'Place plot area' : heatmap && dots ? 'Place corner dots' : 'Place grid corners';

  const rows = useBoundNumber((p, v) => {
    p.grid.rows = clampCount(v);
    p.grid.autoSize = false;
  });
  const cols = useBoundNumber((p, v) => {
    p.grid.cols = clampCount(v);
    p.grid.autoSize = false;
  });
  const fraction = useBoundNumber((p, v) => {
    p.grid.sampleFraction = v;
  });

  // Switching what the clicks mean keeps the same cells: placed points are converted, and the shape and
  // sampled area take the new mode's defaults.
  function switchAnchor(anchor: GridAnchor) {
    w.commit((p) => {
      const pg = p.grid;
      if (pg.anchor === anchor) return;
      if (pg.corners)
        pg.corners = anchor === 'centers' ? cornerCellCenters(pg.corners, pg.rows, pg.cols) : outerCorners(pg);
      pg.anchor = anchor;
      Object.assign(pg, ANCHOR_DEFAULTS[anchor]);
    });
    // Start placing right away: the old points no longer mean the same thing.
    w.setMode('grid');
  }

  function remove() {
    if (
      w.activePanel().rois?.some((r) => r.replicate) &&
      !confirm('Regions copied into every box will have no copies without a grid. Remove the grid?')
    )
      return;
    w.commit((p) => {
      p.grid.corners = null;
    });
  }

  return (
    <>
      <CardHead
        title={
          <>
            <span className="step-dot grid-dot" />
            {plotArea ? 'Plot area' : 'Grid'}
          </>
        }
        tag={roi ? 'optional' : undefined}
        badge={{ id: 'grid-state', text: badge, ok: !!g.corners }}
        actions={
          <IconBtn
            id="grid-clear"
            variant="danger"
            icon="trash"
            label="Remove the grid or plot area"
            disabled={!g.corners}
            onClick={remove}
          />
        }
      />
      <MainStep
        id="grid-place"
        variant="primary"
        icon="place"
        hotkey="grid"
        title="Shortcut: {key}"
        pressed={app.mode?.type === 'grid'}
        onClick={() => w.setMode(app.mode?.type === 'grid' ? null : 'grid')}
      >
        <span id="grid-place-label">{placeLabel}</span>
      </MainStep>
      <Fields hidden={!heatmap}>
        <Field label="Click on" title={ANCHOR_TITLE}>
          <BoundSelect
            id="grid-anchor"
            value={g.anchor}
            options={[
              { value: 'corners', label: 'Outer corners' },
              { value: 'centers', label: 'Dot centers' },
            ]}
            onChange={(v) => switchAnchor(v as GridAnchor)}
          />
        </Field>
      </Fields>
      <Fields hidden={plotArea}>
        <Field label="Rows">
          <BoundInput key={panel.id} id="grid-rows" kind="number" min={1} max={1000} value={g.rows} {...rows} />
        </Field>
        <Field label="Columns">
          <BoundInput key={panel.id} id="grid-cols" kind="number" min={1} max={1000} value={g.cols} {...cols} />
        </Field>
      </Fields>
      <DetectButton hidden={plotArea} />
      <LabelOptions hidden={!heatmap} />
      <BoxNameOptions hidden={!roi} />
      <Options summary="Options">
        <Fields hidden={!heatmap}>
          <Field label="Shape" title="Shape of the sampled area in each cell">
            <BoundSelect
              id="grid-shape"
              value={g.shape}
              options={[
                { value: 'square', label: 'Square' },
                { value: 'circle', label: 'Circle' },
              ]}
              onChange={(v) =>
                w.commit((p) => {
                  p.grid.shape = v as GridShape;
                })
              }
            />
          </Field>
        </Fields>
        <label
          className="field"
          id="grid-fraction-field"
          hidden={!heatmap}
          title={
            dots
              ? "Share of each dot's own radius that is averaged; lower it to stay clear of the dot's edge"
              : 'Share of each cell that is averaged around its center; lower it to stay clear of cell borders'
          }
        >
          Sampled area
          <span className="range-row">
            <BoundInput
              key={panel.id}
              id="grid-fraction"
              kind="range"
              min={0.1}
              max={1}
              step={0.05}
              value={g.sampleFraction}
              {...fraction}
            />
            <output id="grid-fraction-out">{`${Math.round(g.sampleFraction * 100)}%`}</output>
          </span>
        </label>
        <Check
          id="grid-rect"
          label="Keep rectangular when dragging corners"
          checked={app.keepRect}
          onChange={(on) => {
            // Read by interact.ts on the next drag; nothing to redraw.
            app.keepRect = on;
            notify({ light: true });
          }}
        />
      </Options>
    </>
  );
}

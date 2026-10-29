// The Map tool's Results card: bin size, the coordinate units, the value summary and the matrix downloads, and
// the Reconstruct / Show flags toggles (which only change the drawing). Read in render, write in handlers
// (docs/react.md §10).
import type { MapField, MapResult, Panel } from '../../../types/index.ts';
import { BoundInput, Btn, Check, Field, Fields, Hint, Notice, SplitActions } from '../../../ui/index.ts';
import { formatNumber, mapLongCsv, mapMatrixCsv } from '../../project/project-files.ts';
import { useBoundNumber } from '../../react/use-bound.ts';
import { useWorkspace } from '../../react/use-workspace.ts';
import { notify } from '../../workspace/store.ts';
import { axisFn, coordKind, mapSize } from '../field.ts';
import { useMapTool } from './map-context.ts';
import { UnitsSelect } from './units-select.tsx';

type Field_ = MapField & { axisProblems?: string[] };

function summaryText(res: Field_, panel: Panel): string {
  const s = res.stats;
  const clipped = s.clippedLow + s.clippedHigh;
  const total = res.values.length;
  const pct = (n: number) => (n / total < 0.001 && n ? '<0.1' : ((100 * n) / total).toFixed(1));
  return [
    `${res.cols} × ${res.rows} values${res.bin > 1 ? ` (bins of ${res.bin} px)` : ' (native pixels)'}`,
    `range ${formatNumber(s.min)} – ${formatNumber(s.max)}`,
    `colorbar resolves about ${s.levels} levels`,
    s.flagged ? `${s.flagged} flagged (${pct(s.flagged)}%, ΔE > ${panel.settings.maxDeltaE})` : 'no flagged values',
    clipped ? `${clipped} at a colorbar end (${pct(clipped)}%, may be clipped)` : 'none at a colorbar end',
  ].join(' · ');
}

export function MapResultsCard() {
  const { ws, w } = useWorkspace({ section: 'sec-map-results' });
  const { state } = useMapTool();
  const panel = w.activePanel();
  // A render queued before a tool switch can see another tool's panel; its result is not a map field.
  const isMap = panel.tool === 'map';
  const res = (isMap ? ws.resultFor(panel) : { error: '' }) as Field_;
  const axisFns = (['x', 'y'] as const).map((k) => !!(panel.grid.corners && axisFn(panel, k).fn));
  const hasAxis = axisFns.some(Boolean);
  const bin = useBoundNumber((p, v) => {
    p.map.bin = Math.min(256, Math.max(1, Math.round(v)));
  });
  // One setting for the profile plot and the matrix, edited from either card.
  const setUnits = (units: Panel['map']['units']) =>
    ws.commit((p) => {
      p.map.units = units;
    });
  const download = (long: boolean) => {
    const p = ws.activePanel();
    const r = ws.resultFor(p) as MapResult;
    if (r.error) return;
    if (long)
      ws.download(new Blob([mapLongCsv([{ panel: p, result: r }])], { type: 'text/csv' }), ws.csvName(p, '_map_long'));
    else ws.download(new Blob([mapMatrixCsv(p, r as MapField)], { type: 'text/csv' }), ws.csvName(p, '_map'));
  };
  const toggle = (key: 'showRecon' | 'showFlags', on: boolean) => {
    // Only the drawing changes: redraw, and re-render the toggle (no project change, no listeners).
    state[key] = on;
    ws.viewer.requestDraw();
    notify({ light: true });
  };
  return (
    <>
      {/* The toggles sit straight in the head: extract.css pushes a head's first .check to the right. */}
      <div className="card-head">
        <h2>Results</h2>
        <Check
          id="map-recon"
          label="Reconstruct"
          checked={state.showRecon}
          onChange={(on) => toggle('showRecon', on)}
        />
        <Check
          id="map-flags"
          label="Show flags"
          title="Red: color far from the colorbar (ΔE). Magenta / cyan: at the top / bottom end of the colorbar, possibly clipped. Colors can be changed in Settings."
          checked={state.showFlags}
          onChange={(on) => toggle('showFlags', on)}
        />
      </div>
      <Fields>
        <Field
          label="Bin size (px)"
          title="Side of the square bins in pixels of the rendered image; each bin is the median of its pixels. 1 = one value per pixel."
        >
          <BoundInput
            key={panel.id}
            id="map-bin"
            kind="number"
            min={1}
            max={256}
            step={1}
            value={panel.map.bin}
            {...bin}
          />
        </Field>
        <Field
          label="Coordinates"
          title="How x and y are reported in the CSVs and the status bar: axis values (with axis ticks), pixels from the plot's top-left corner, or scale-bar lengths from that corner. Shared with the profile plot's X axis."
        >
          {/* With one axis calibrated, 'axis' reports the other in length or pixels. */}
          <UnitsSelect
            id="map-units"
            panel={panel}
            hasAxis={hasAxis}
            value={hasAxis && panel.map.units === 'axis' ? 'axis' : coordKind(panel, 'x')}
            onChange={setUnits}
          />
        </Field>
      </Fields>
      <Notice id="map-problem">{res.error || ''}</Notice>
      <Hint id="map-summary">
        {res.error || !('stats' in res)
          ? isMap && panel.grid.corners
            ? sizeText(panel)
            : ''
          : summaryText(res, panel)}
      </Hint>
      <Hint id="map-axis-hint">{res.axisProblems?.join(' ') || ''}</Hint>
      <SplitActions>
        <Btn
          id="map-dl-csv"
          variant="primary"
          icon="download"
          title="The value matrix: one row per bin row, one column per bin column"
          disabled={!!res.error}
          onClick={() => download(false)}
        >
          Download CSV
        </Btn>
        <Btn
          id="map-dl-long"
          icon="download"
          title="One line per bin with its coordinates, ΔE and flags"
          disabled={!!res.error}
          onClick={() => download(true)}
        >
          Long CSV
        </Btn>
      </SplitActions>
    </>
  );
}

function sizeText(panel: Panel) {
  const { rows, cols } = mapSize(panel);
  return `${cols} × ${rows} values at this bin size.`;
}

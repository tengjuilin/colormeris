// The heatmap Results card: summary, the value table, CSV downloads and Copy table, and the Reconstruct
// toggle. The table stays imperative (results-table.ts) inside a ref host: it can hold a million cells and the
// hover highlight adds a class (`td.hl`) that React would wipe on a re-render. It is rebuilt only when the
// cached result changes. Read in render, write in handlers (docs/react.md, "The card pattern").
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { HeatmapResult, Panel, Workspace, WorkspaceContext } from '../../../types/index.ts';
import { Btn, Check, Hint, MainStep, Notice, SplitActions } from '../../../ui/index.ts';
import { toLongCsv, toWideCsv } from '../../project/project-files.ts';
import { useTableHover } from '../../react/use-table-hover.ts';
import { useWorkspace } from '../../react/use-workspace.ts';
import { copyTable, downloadCsv } from '../../results-actions.ts';
import { notify } from '../../workspace/store.ts';
import { fillResultTable, heatmapSummary, highlightTableCell } from '../results-table.ts';

type Result = HeatmapResult | { error: string };

/** The table as tab-separated text for a spreadsheet. */
export function toTsv(panel: Panel, res: HeatmapResult): string {
  return toWideCsv(panel, res)
    .trim()
    .split('\n')
    .map((line) => line.replace(/"([^"]|"")*"|,/g, (m) => (m === ',' ? '\t' : m.slice(1, -1).replace(/""/g, '"'))))
    .join('\n');
}

function copy(w: WorkspaceContext) {
  const panel = w.activePanel();
  const res = w.resultFor(panel) as HeatmapResult;
  if (!res.error) void copyTable(w, toTsv(panel, res));
}

function download(w: WorkspaceContext, long: boolean) {
  const p = w.activePanel();
  const r = w.resultFor(p) as HeatmapResult;
  if (r.error) return;
  if (long) downloadCsv(w, p, toLongCsv([{ panel: p, result: r }]), '_long');
  else downloadCsv(w, p, toWideCsv(p, r));
}

/**
 * The table host: rebuilt when `res` or the labels change, hover on a cell marks it on the image. While a
 * handle is dragged the table waits for the drop: rebuilding a large one on every move (and the layout that
 * follows) took longer than a frame.
 */
function ResultTable({ w, panel, res }: { w: WorkspaceContext; panel: Panel; res: Result }) {
  const table = useRef<HTMLTableElement>(null);
  // The result's cache key leaves the labels out, and typing replaces the arrays (grid-labels.tsx).
  const { rowLabels, colLabels } = panel.grid;
  const dragging = !!w.app.drag;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the labels are read by fillResultTable through panel
  useLayoutEffect(() => {
    if (!table.current || dragging) return;
    fillResultTable(table.current, panel, res);
    highlightTableCell(table.current, w.app.hoverCell);
  }, [panel, res, w, rowLabels, colLabels, dragging]);

  useTableHover(w, table);

  return (
    <div className="table-wrap">
      <table id="result-table" className="result-table" ref={table} />
    </div>
  );
}

export function HeatmapResultsCard() {
  const { w } = useWorkspace({ section: 'sec-hm-results' });
  const panel = w.activePanel();
  // Only heatmap panels have cells. Gate on the panel, not w.tool(): right after a tool switch the active panel
  // may already belong to the new tool.
  const res: Result = panel.tool === 'heatmap' ? (w.resultFor(panel) as Result) : { error: '' };
  const error = 'error' in res && res.error ? res.error : '';
  // O(cells): recomputed only when the result or the flag threshold changes, not on every render.
  const maxDeltaE = panel.settings.maxDeltaE;
  const summary = useMemo(() => ('cells' in res ? heatmapSummary(res, maxDeltaE) : ''), [res, maxDeltaE]);
  return (
    <>
      {/* The toggle sits straight in the head: extract.css pushes a head's first .check to the right. */}
      <div className="card-head">
        <h2>Results</h2>
        <Check
          id="toggle-recon"
          label="Reconstruct"
          checked={w.app.showRecon}
          onChange={(on) => {
            // Only the drawing changes: redraw, and re-render the toggle (no project change, no listeners).
            w.app.showRecon = on;
            w.viewer.requestDraw();
            notify({ light: true });
          }}
        />
      </div>
      <Notice id="result-problem">{error}</Notice>
      <Hint id="result-summary">{summary}</Hint>
      <ResultTable w={w} panel={panel} res={res} />
      <MainStep
        id="dl-csv"
        variant="primary"
        icon="download"
        title="The table as shown: one row per grid row"
        disabled={!!error}
        onClick={() => download(w, false)}
      >
        Download CSV
      </MainStep>
      <SplitActions>
        <Btn
          id="dl-long"
          icon="download"
          title="One line per cell with its color, ΔE and flag"
          disabled={!!error}
          onClick={() => download(w, true)}
        >
          Long CSV
        </Btn>
        <Btn
          id="copy-tsv"
          icon="copy"
          title="Copy the table to paste into a spreadsheet"
          disabled={!!error}
          onClick={() => copy(w)}
        >
          Copy table
        </Btn>
      </SplitActions>
    </>
  );
}

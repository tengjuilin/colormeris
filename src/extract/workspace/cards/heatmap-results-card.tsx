// The heatmap Results card: summary, the value table, CSV downloads and Copy table, and the Reconstruct
// toggle. The table stays imperative (results-table.ts) inside a ref host: it can hold a million cells and the
// hover highlight adds a class (`td.hl`) that React would wipe on a re-render. It is rebuilt only when the
// cached result changes. Read in render, write in handlers (docs/react.md §10).
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { HeatmapResult, Panel, Workspace, WorkspaceContext } from '../../../types/index.ts';
import { Btn, Check, Hint, MainStep, Notice, SplitActions } from '../../../ui/index.ts';
import { fillResultTable, heatmapSummary, highlightTableCell } from '../../heatmap/results-table.ts';
import { toLongCsv, toWideCsv } from '../../project/project-files.ts';
import { useWorkspace } from '../../react/use-workspace.ts';
import { notify } from '../store.ts';

type Result = HeatmapResult | { error: string };

/** The table as tab-separated text for a spreadsheet. */
export function toTsv(panel: Panel, res: HeatmapResult): string {
  return toWideCsv(panel, res)
    .trim()
    .split('\n')
    .map((line) => line.replace(/"([^"]|"")*"|,/g, (m) => (m === ',' ? '\t' : m.slice(1, -1).replace(/""/g, '"'))))
    .join('\n');
}

async function copyTable(ws: Workspace) {
  const panel = ws.activePanel();
  const res = ws.resultFor(panel) as HeatmapResult;
  if (res.error) return;
  try {
    await navigator.clipboard.writeText(toTsv(panel, res));
    ws.toast('Table copied — paste into a spreadsheet.');
  } catch {
    ws.toast('Clipboard is not available here.', true);
  }
}

function download(ws: Workspace, long: boolean) {
  const p = ws.activePanel();
  const r = ws.resultFor(p) as HeatmapResult;
  if (r.error) return;
  if (long) ws.download(new Blob([toLongCsv([{ panel: p, result: r }])], { type: 'text/csv' }), ws.csvName(p, '_long'));
  else ws.download(new Blob([toWideCsv(p, r)], { type: 'text/csv' }), ws.csvName(p));
}

/** The table host: rebuilt when `res` changes, hover on a cell marks it on the image. */
function ResultTable({ w, panel, res }: { w: WorkspaceContext; panel: Panel; res: Result }) {
  const table = useRef<HTMLTableElement>(null);

  useLayoutEffect(() => {
    if (!table.current) return;
    fillResultTable(table.current, panel, res);
    highlightTableCell(table.current, w.app.hoverCell);
  }, [panel, res, w]);

  useEffect(() => {
    const el = table.current;
    if (!el) return;
    const over = (e: PointerEvent) => {
      const td = (e.target as HTMLElement).closest('td');
      w.app.tableCell = td ? { row: Number(td.dataset.r), col: Number(td.dataset.c) } : null;
      w.viewer.requestDraw();
    };
    const leave = () => {
      w.app.tableCell = null;
      w.viewer.requestDraw();
    };
    el.addEventListener('pointerover', over);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointerover', over);
      el.removeEventListener('pointerleave', leave);
    };
  }, [w]);

  return (
    <div className="table-wrap">
      <table id="result-table" className="result-table" ref={table} />
    </div>
  );
}

export function HeatmapResultsCard() {
  const { ws, w } = useWorkspace({ section: 'sec-hm-results' });
  const panel = w.activePanel();
  // Only the heatmap tool shows this card; another tool's result has no cells.
  const res: Result = w.tool().kind === 'heatmap' ? (ws.resultFor(panel) as Result) : { error: '' };
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
        onClick={() => download(ws, false)}
      >
        Download CSV
      </MainStep>
      <SplitActions>
        <Btn
          id="dl-long"
          icon="download"
          title="One line per cell with its color, ΔE and flag"
          disabled={!!error}
          onClick={() => download(ws, true)}
        >
          Long CSV
        </Btn>
        <Btn
          id="copy-tsv"
          icon="copy"
          title="Copy the table to paste into a spreadsheet"
          disabled={!!error}
          onClick={() => void copyTable(ws)}
        >
          Copy table
        </Btn>
      </SplitActions>
    </>
  );
}

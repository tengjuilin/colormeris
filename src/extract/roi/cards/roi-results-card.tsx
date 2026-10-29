// The ROI Results card: summary, metric select, the region × measurement table, CSV download and Copy table.
// The table stays imperative inside a ref host (cells carry data-r / data-c for the hover link to the image and
// the table can be large); it is rebuilt only when the cached result, the metric or the unit changes.
// Read in render, write in handlers (docs/react.md §10).
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Panel, RoiResult, RoiStats, Workspace, WorkspaceContext } from '../../../types/index.ts';
import { BoundSelect, Btn, Check, Field, Hint, Notice, SplitActions } from '../../../ui/index.ts';
import { formatNumber, roiCsv } from '../../project/project-files.ts';
import { useWorkspace } from '../../react/use-workspace.ts';
import { notify } from '../../workspace/store.ts';
import { metricFor, metricValue, roiTableModel, shortNumber } from '../quantify.ts';
import { useRoiContext } from './roi-context.ts';

type Result = RoiResult | { error: string };

// Not `'rows' in res`: a map field has numeric rows.
const hasRows = (res: Result): res is RoiResult => Array.isArray((res as RoiResult).rows);

export const METRIC_NAMES: Record<string, string> = {
  sum: 'Total signal',
  mean: 'Mean over region',
  max: 'Max',
  meanSignal: 'Mean over signal pixels',
  signalPx: 'Signal area (px)',
  areaPx: 'Region area (px)',
  sumArea: 'Total signal × area',
  signalArea: 'Signal area',
  area: 'Region area',
};

/** The select's options; the scaled ones need a scale bar and name its unit. */
export function metricOptions(unit: string | null) {
  const u = unit ?? 'unit';
  return [
    { value: 'sum', label: 'Total signal (sum)' },
    { value: 'mean', label: 'Mean over region' },
    { value: 'max', label: 'Max' },
    { value: 'meanSignal', label: 'Mean over signal pixels' },
    { value: 'signalPx', label: 'Signal area (px)' },
    { value: 'areaPx', label: 'Region area (px)' },
    { value: 'sumArea', label: 'Total signal × area', scaled: true },
    { value: 'signalArea', label: `Signal area (${u}²)`, scaled: true },
    { value: 'area', label: `Region area (${u}²)`, scaled: true },
  ];
}

/** The table as tab-separated text for a spreadsheet. */
export function roiTsv(panel: Panel, res: RoiResult, metric: keyof RoiStats): string {
  const model = roiTableModel(panel, res);
  const lines = [[METRIC_NAMES[metric], ...model.rois.map((r) => r.name)].join('\t')];
  for (const row of model.rows) {
    lines.push(
      [
        row.label,
        ...model.rois.map((roi) => {
          const r = row.cells.get(roi.id);
          const v = r ? metricValue(r.stats, metric) : null;
          return v === null ? '' : formatNumber(v);
        }),
      ].join('\t'),
    );
  }
  return lines.join('\n');
}

export function roiSummary(panel: Panel, res: RoiResult): string {
  const flagged = res.rows.reduce((s, r) => s + r.stats.flaggedPx, 0);
  const signal = res.rows.reduce((s, r) => s + r.stats.signalPx, 0);
  const unit = res.unit ? ` · areas in ${res.unit}²` : ' · pixel units';
  return (
    `${panel.rois.length} region${panel.rois.length === 1 ? '' : 's'} · ${res.rows.length} measurement${res.rows.length === 1 ? '' : 's'}${unit}` +
    (flagged
      ? ` · ${((100 * flagged) / Math.max(1, signal)).toFixed(1)}% of signal pixels matched no colorbar color (ΔE > ${panel.settings.maxDeltaE}); cells over 10% are outlined`
      : '')
  );
}

function th(text: string, rowhead = false) {
  const el = document.createElement('th');
  el.textContent = text;
  if (rowhead) el.className = 'rowhead';
  return el;
}

/** Rebuild the table: regions across, one row per box (or one row for single regions). */
export function fillRoiTable(table: HTMLTableElement, panel: Panel, res: Result, metric: keyof RoiStats) {
  if (!hasRows(res)) return table.replaceChildren();
  const model = roiTableModel(panel, res);
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  hr.append(th(METRIC_NAMES[metric], true), ...model.rois.map((r) => th(r.name)));
  thead.append(hr);
  const tbody = document.createElement('tbody');
  for (const row of model.rows) {
    const tr = document.createElement('tr');
    tr.append(th(row.label, true));
    for (const roi of model.rois) {
      const td = document.createElement('td');
      const r = row.cells.get(roi.id);
      if (r) {
        const value = metricValue(r.stats, metric);
        td.textContent = value === null ? '' : shortNumber(value);
        td.title = `${row.label} · ${roi.name}\nsum ${formatNumber(r.stats.sum)}\nmean ${formatNumber(r.stats.mean)}\nmax ${formatNumber(r.stats.max)}\nsignal ${r.stats.signalPx} of ${r.stats.areaPx} px`;
        // Outline when a noticeable share of the signal matched no colorbar color.
        if (r.stats.flaggedPx > 0.1 * r.stats.signalPx) td.classList.add('flagged');
      }
      if (row.row !== null) {
        td.dataset.r = String(row.row);
        td.dataset.c = String(row.col);
      }
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.replaceChildren(thead, tbody);
}

async function copyTable(ws: Workspace, metric: keyof RoiStats) {
  const panel = ws.activePanel();
  const res = ws.resultFor(panel) as Result;
  if ('error' in res && res.error) return;
  try {
    await navigator.clipboard.writeText(roiTsv(panel, res as RoiResult, metricFor(metric, !!panel.scale)));
    ws.toast('Table copied — paste into a spreadsheet.');
  } catch {
    ws.toast('Clipboard is not available here.', true);
  }
}

function ResultTable({
  w,
  panel,
  res,
  metric,
}: {
  w: WorkspaceContext;
  panel: Panel;
  res: Result;
  metric: keyof RoiStats;
}) {
  const table = useRef<HTMLTableElement>(null);
  // panel.rois names are part of the header: rebuild when the result object changes (it does for any edit).
  useLayoutEffect(() => {
    if (table.current) fillRoiTable(table.current, panel, res, metric);
  }, [panel, res, metric]);

  useEffect(() => {
    const el = table.current;
    if (!el) return;
    const over = (e: PointerEvent) => {
      const td = (e.target as HTMLElement).closest<HTMLElement>('td[data-r]');
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
      <table id="roi-result-table" className="result-table" ref={table} />
    </div>
  );
}

export function RoiResultsCard() {
  const { ws, w } = useWorkspace({ section: 'sec-roi-results' });
  const { state } = useRoiContext();
  const panel = w.activePanel();
  // Only the ROI tool shows this card; another tool's result has no regions.
  const res: Result = panel.tool === 'roi' ? (ws.resultFor(panel) as Result) : { error: '' };
  const error = 'error' in res && res.error ? res.error : '';
  const metric = metricFor(state.metric, !!panel.scale);
  const summary = error || !hasRows(res) ? '' : roiSummary(panel, res);
  const options = metricOptions(panel.scale?.unit ?? null);

  return (
    <>
      <div className="card-head">
        <h2>Results</h2>
        <Check
          id="toggle-mask"
          label="Show signal"
          title="Tint the pixels counted as signal"
          checked={state.showMask}
          onChange={(on) => {
            state.showMask = on;
            w.viewer.requestDraw();
            notify({ light: true });
          }}
        />
      </div>
      <Notice id="roi-result-problem">{error}</Notice>
      <Hint id="roi-result-summary">{summary}</Hint>
      <Field label="Show">
        <BoundSelect
          id="result-metric"
          value={metric}
          onChange={(v) => {
            state.metric = v as keyof RoiStats;
            ws.changed();
          }}
        >
          {options.map((o) => (
            <option
              key={o.value}
              value={o.value}
              data-scaled={o.scaled ? '' : undefined}
              disabled={o.scaled && !panel.scale}
            >
              {o.label}
            </option>
          ))}
        </BoundSelect>
      </Field>
      <ResultTable w={w} panel={panel} res={res} metric={metric} />
      <SplitActions>
        <Btn
          id="roi-dl-csv"
          variant="primary"
          icon="download"
          disabled={!!error}
          onClick={() => {
            const p = ws.activePanel();
            const r = ws.resultFor(p) as Result;
            if (!('error' in r && r.error))
              ws.download(
                new Blob([roiCsv([{ panel: p, result: r as RoiResult }])], { type: 'text/csv' }),
                ws.csvName(p, '_rois'),
              );
          }}
        >
          Download CSV
        </Btn>
        <Btn
          id="roi-copy-tsv"
          icon="copy"
          title="Copy the table to paste into a spreadsheet"
          disabled={!!error}
          onClick={() => void copyTable(ws, state.metric)}
        >
          Copy table
        </Btn>
      </SplitActions>
    </>
  );
}

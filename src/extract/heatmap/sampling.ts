import { rgbToLab } from '../../core/color.ts';
import {
  colorbarBins,
  colorbarSamples,
  colorStatus,
  labelBins,
  labToT,
  makeValueFn,
  nearestBin,
} from '../../core/colorbar.ts';
import { dotRadius, sampleCell } from '../../core/grid.ts';
import type {
  CellCounts,
  CellStatus,
  ColorbarSample,
  ErrorResult,
  HeatmapCell,
  HeatmapResult,
  Lab,
  LabelledBin,
  OpenSide,
  Panel,
  PanelSettings,
  PixelImage,
} from '../../types/index.ts';
import { colorbarProblem, ticksWithT } from '../project/project.ts';

/** What matchColor needs of a calibrated panel. */
interface MatchContext {
  samples: ColorbarSample[];
  bins: LabelledBin[] | null;
  valueAt: (t: number) => number;
  settings: PanelSettings;
}

// Combine grid sampling and colorbar calibration into a value matrix.

// Returns a description of what is still missing before extraction, or null.
export function panelProblem(panel: Panel): string | null {
  if (!panel.grid.corners) return 'Set the heatmap grid corners.';
  // Dot centers give the cell spacing only with at least two dots per side.
  if (panel.grid.anchor === 'centers' && (panel.grid.rows < 2 || panel.grid.cols < 2))
    return 'Dot centers need at least 2 rows and 2 columns.';
  return colorbarProblem(panel);
}

// Matches a cell color to the bar once (heatmaps repeat colors a lot).
// Returns {t, value, deltaE, status, end?, open?, reason?, bin?}; value is
// NaN for an off-map color. On a binned bar the cell takes its nearest
// bin's middle value (bins from labelBins in core/colorbar.js).
function matchColor(lab: Lab, ctx: MatchContext) {
  const { samples, bins, valueAt, settings } = ctx;
  let match: { t: number; deltaE: number; lab?: Lab };
  let value: number;
  let open: OpenSide | null = null;
  let bin = 0;
  let endT: number;
  if (bins) {
    const near = nearestBin(lab, bins, settings.distance);
    bin = near.index;
    const b = bins[bin];
    match = { t: (b.t0 + b.t1) / 2, deltaE: near.deltaE, lab: b.lab };
    value = b.value;
    open = b.open;
    // Only an end bin can hold cells past the bar's end.
    endT = bin === 0 ? b.t0 : bin === bins.length - 1 ? b.t1 : match.t;
  } else {
    match = labToT(lab, samples, settings.distance);
    value = valueAt(match.t);
    endT = match.t;
  }
  const s = colorStatus(lab, { ...match, t: endT }, samples, settings.maxDeltaE);
  if (s.status === 'clamped') {
    // Every cell past one end reads as that end (its spot on a flat end is
    // arbitrary), and the true value lies past it: below or above.
    const [tEnd, tOther] = s.end === 'start' ? [0, 1] : [1, 0];
    open = valueAt(tEnd) >= valueAt(tOther) ? 'above' : 'below';
    value = bins ? bins[s.end === 'start' ? 0 : bins.length - 1].value : valueAt(tEnd);
  }
  if (s.status === 'off-map') value = NaN;
  return {
    t: match.t,
    value,
    deltaE: match.deltaE,
    status: s.status,
    ...(s.end ? { end: s.end } : {}),
    ...(s.reason ? { reason: s.reason } : {}),
    ...(open && s.status !== 'off-map' ? { open } : {}),
    ...(bins ? { bin } : {}),
  };
}

// Counts of each cell status, and the share of valued cells that clamp to
// an end of the bar (a figure whose cells mostly go past its colorbar).
function countCells(cells: HeatmapCell[][]) {
  const counts: CellCounts = { cells: 0, ok: 0, flagged: 0, clamped: 0, offMap: 0, empty: 0, open: 0 };
  for (const c of cells.flat()) {
    counts.cells++;
    if (c.status === 'off-map') counts.offMap++;
    else counts[c.status as Exclude<CellStatus, 'off-map'>]++;
    if (c.open) counts.open++;
  }
  const filled = counts.cells - counts.empty;
  return { counts, clampedShare: filled ? counts.clamped / filled : 0 };
}

// Result: {rows, cols, cells, samples, scale, bins, counts, clampedShare}
// or {error} when the panel is not fully calibrated.
// cells[r][c] = {rgb, t, value, deltaE, flagged, status, end?, open?, reason?, bin?, radius?, empty?}
// status: 'ok'; 'flagged' (deltaE > maxDeltaE, still valued); 'clamped'
// (past the bar's `end`, 'start' or 'end', valued as that end); 'off-map'
// (not a colormap color: value NaN, reason 'gray' | 'hue' | 'far'); 'empty'
// (a dot plot cell without a dot, value NaN). `flagged` is true for flagged
// and off-map cells and for clamped ones over maxDeltaE. `open` 'below' or
// 'above' says the value is a bound (≤ or ≥): clamped cells and cells in
// an open-ended bin. `bins` is null for a smooth bar, else
// [{t0, t1, rgb, lab, value, open}] (labelBins) and `bin` is a cell's index.
// With dot centers each cell is sampled inside its own dot (radius in image
// pixels).
export function extractPanel(img: PixelImage, panel: Panel): HeatmapResult | ErrorResult {
  const error = panelProblem(panel);
  if (error) return { error };
  const cb = panel.colorbar;
  const samples = colorbarSamples(img, cb);
  const ticks = ticksWithT(cb);
  const valueAt = makeValueFn(ticks, cb.scale);
  const bins = labelBins(colorbarBins(samples), ticks, cb.scale, samples.length);
  const ctx: MatchContext = { samples, bins, valueAt: valueAt!, settings: panel.settings };
  const { rows, cols } = panel.grid;
  const matches = new Map<string, ReturnType<typeof matchColor>>();
  const dots = panel.grid.anchor === 'centers';
  const cells: HeatmapCell[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: HeatmapCell[] = [];
    for (let c = 0; c < cols; c++) {
      const radius = dots ? dotRadius(img, panel.grid, r, c) : null;
      if (dots && !radius) {
        row.push({
          rgb: null,
          t: NaN,
          value: NaN,
          deltaE: NaN,
          flagged: false,
          status: 'empty',
          radius: null,
          empty: true,
        });
        continue;
      }
      const rgb = sampleCell(img, panel.grid, r, c, radius);
      const key = rgb.join(',');
      let match = matches.get(key);
      if (!match) {
        match = matchColor(rgbToLab(rgb), ctx);
        matches.set(key, match);
      }
      const flagged = match.status === 'off-map' || match.deltaE > panel.settings.maxDeltaE;
      row.push({ rgb, ...match, flagged, ...(dots ? { radius } : {}) });
    }
    cells.push(row);
  }
  return { rows, cols, cells, samples, scale: cb.scale, bins, ...countCells(cells) };
}

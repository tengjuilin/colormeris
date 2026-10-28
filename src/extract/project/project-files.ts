import type JSZipType from 'jszip';
import type {
  HeatmapResult,
  MapField,
  MapResult,
  Panel,
  PanelResult,
  ProfileSample,
  Project,
  RoiResult,
  ScaleUnit,
} from '../../types/index.ts';
import { FLAG_DELTA_E, FLAG_HIGH, FLAG_LOW, lengthPerPixel } from '../map/field.ts';
import { boxLabel, effectiveLabels, parseProject, type Raw, serializeProject } from './project.ts';

/** A panel with its result, as the exports take them. */
export interface ResultItem<R = PanelResult> {
  panel: Panel;
  result: R;
}

/** A file to put in the project zip. */
export interface ZipFile {
  path: string;
  content: string | Blob;
}

/** Profile normalisation of a CSV: value / divisor (see profileDivisor). */
export interface ProfileNorm {
  mode: string;
  divisor: number;
}

// CSV formatting and project zip packaging.

export function formatNumber(v: number | null | undefined) {
  if (!Number.isFinite(v)) return '';
  return String(Number((v as number).toPrecision(6)));
}

export function csvEscape(v: unknown) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (cells: unknown[]) => cells.map(csvEscape).join(',');

// Matrix layout: first column row labels, header row column labels.
export function toWideCsv(panel: Panel, result: HeatmapResult) {
  const rowLabels = effectiveLabels(panel.grid.rowLabels, result.rows, 'R');
  const colLabels = effectiveLabels(panel.grid.colLabels, result.cols, 'C');
  const lines = [csvLine(['row\\col', ...colLabels])];
  result.cells.forEach((row, r) => {
    lines.push(csvLine([rowLabels[r], ...row.map((c) => formatNumber(c.value))]));
  });
  return lines.join('\n') + '\n';
}

// Tidy layout with diagnostics, one line per cell. `items` is [{panel, result}].
// status: ok, flagged, clamped (past an end of the bar), off-map (no
// value; reason gray, hue or far) or empty; bound: <= or >= when the
// value is only a bound (past a bar end, or an open end bin).
export function toLongCsv(items: ResultItem[]) {
  const lines = [
    csvLine(['panel', 'page', 'row', 'col', 'value', 'r', 'g', 'b', 'deltaE', 'flagged', 'status', 'bound', 'reason']),
  ];
  for (const { panel, result: res } of items) {
    if (res.error) continue;
    const result = res as HeatmapResult;
    const rowLabels = effectiveLabels(panel.grid.rowLabels, result.rows, 'R');
    const colLabels = effectiveLabels(panel.grid.colLabels, result.cols, 'C');
    result.cells.forEach((row, r) => {
      row.forEach((c, k) => {
        lines.push(
          csvLine([
            panel.name,
            panel.page,
            rowLabels[r],
            colLabels[k],
            formatNumber(c.value),
            // An empty cell (dot plot without a dot) has no color.
            ...(c.rgb ? c.rgb.map((x) => Math.round(x)) : ['', '', '']),
            Number.isFinite(c.deltaE) ? c.deltaE.toFixed(2) : '',
            c.flagged ? 1 : 0,
            c.status || (c.empty ? 'empty' : c.flagged ? 'flagged' : 'ok'),
            c.open === 'below' ? '<=' : c.open === 'above' ? '>=' : '',
            c.reason || '',
          ]),
        );
      });
    });
  }
  return lines.join('\n') + '\n';
}

export function safeFileName(name: unknown) {
  const s = String(name)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || 'untitled';
}

const README = `Colormeris project archive

project.json          Calibration metadata (grid corners, colorbar line and ticks,
                      labels, settings, page and review of each panel).
                      Coordinates are pixels in the panel's source/page-<n>.png.
source/               The original uploaded file and the rendered image of each
                      page that has panels.
data/                 Extracted data as CSV, one or more files per panel.
agent/                actions.json and decisions.json: what the agent API and the
                      heatmap agent changed and decided (with confidences).

Load this zip back into Colormeris to review or re-run the extraction.
`;

const pageImagePath = (page: number | string) => `source/page-${page}.png`;

// Region statistics, one line per region copy. `items` is [{panel, result}]
// with results from quantifyPanel.
export function roiCsv(items: ResultItem[]) {
  const unit = (items.find((it) => (it.result as RoiResult).unit)?.result as RoiResult | undefined)?.unit;
  const head = [
    'panel',
    'page',
    'box',
    'row',
    'col',
    'roi',
    'shape',
    'area_px',
    'signal_px',
    'flagged_px',
    'sum',
    'mean',
    'mean_signal',
    'max',
  ];
  if (unit) head.push(`area_${unit}2`, `signal_area_${unit}2`, 'sum_x_area');
  const lines = [csvLine(head)];
  for (const { panel, result: res } of items) {
    if (res.error) continue;
    const result = res as RoiResult;
    for (const r of result.rows) {
      const s = r.stats;
      const inBox = r.row !== null;
      const line = [
        panel.name,
        panel.page,
        inBox ? boxLabel(panel.grid, r.row as number, r.col as number) : '',
        inBox ? (r.row as number) + 1 : '',
        inBox ? (r.col as number) + 1 : '',
        r.roi.name,
        r.roi.shape,
        s.areaPx,
        s.signalPx,
        s.flaggedPx,
        formatNumber(s.sum),
        formatNumber(s.mean),
        formatNumber(s.meanSignal),
        formatNumber(s.max),
      ];
      if (unit)
        line.push(
          ...(s.area !== undefined
            ? [formatNumber(s.area), formatNumber(s.signalArea), formatNumber(s.sumArea)]
            : ['', '', '']),
        );
      lines.push(csvLine(line));
    }
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- map CSVs
// Results come from extractMap (map/field.ts, which also exports the flag
// constants imported above).

// Column headers of a map: axis names, or pixel or scale-bar offsets (see mapCoord).
const mapAxisNames = (result: MapField) => [
  result.xName ?? (result.xAxis ? 'x' : 'x_px'),
  result.yName ?? (result.yAxis ? 'y' : 'y_px'),
];

// Matrix layout: header row of x at bin centres, first column y at bin centres,
// rows top to bottom as on the page.
export function mapMatrixCsv(panel: Panel, result: MapField) {
  const [xn, yn] = mapAxisNames(result);
  const lines = [csvLine([`${yn}\\${xn}`, ...result.xs.map((x) => formatNumber(x))])];
  for (let r = 0; r < result.rows; r++) {
    const row = [formatNumber(result.ys[r])];
    for (let c = 0; c < result.cols; c++) row.push(formatNumber(result.values[r * result.cols + c]));
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

// Tidy layout with diagnostics, one line per bin. `items` is [{panel, result}].
export function mapLongCsv(items: ResultItem[]) {
  const [xn, yn] = items.length && !items[0].result.error ? mapAxisNames(items[0].result as MapField) : ['x', 'y'];
  const lines = [csvLine(['panel', 'page', 'row', 'col', xn, yn, 'value', 'deltaE', 'flagged', 'clipped'])];
  for (const { panel, result: res } of items) {
    if (res.error) continue;
    const result = res as MapField;
    const name = csvEscape(panel.name);
    for (let r = 0; r < result.rows; r++) {
      for (let c = 0; c < result.cols; c++) {
        const i = r * result.cols + c;
        const f = result.flags[i];
        const clip = f & FLAG_LOW ? 'low' : f & FLAG_HIGH ? 'high' : '';
        lines.push(
          [
            name,
            panel.page,
            r + 1,
            c + 1,
            formatNumber(result.xs[c]),
            formatNumber(result.ys[r]),
            formatNumber(result.values[i]),
            result.deltaE[i].toFixed(2),
            f & FLAG_DELTA_E ? 1 : 0,
            clip,
          ].join(','),
        );
      }
    }
  }
  return lines.join('\n') + '\n';
}

// One line per profile sample (from sampleProfile). With norm = {mode,
// divisor} ('max' | 'mean', see profileDivisor), a value_per_<mode> column
// follows the value. With a scale-bar unit, a d_<unit> column follows d_px.
// Samples outside the plot area are left out.
export function profileCsv(samples: ProfileSample[], norm: ProfileNorm | null = null, unit: ScaleUnit | null = null) {
  const head = [
    'd_px',
    ...(unit ? [`d_${unit}`] : []),
    'x',
    'y',
    'page_x',
    'page_y',
    'value',
    ...(norm ? [`value_per_${norm.mode}`] : []),
    'deltaE',
    'flagged',
    'clipped',
  ];
  const lines = [csvLine(head)];
  for (const s of samples) {
    if (s.outside) continue;
    const len = unit ? [formatNumber(s.len as number)] : [];
    const scaled = norm ? [formatNumber(s.value / norm.divisor)] : [];
    lines.push(
      [
        s.d.toFixed(2),
        ...len,
        formatNumber(s.x as number),
        formatNumber(s.y as number),
        s.px.toFixed(2),
        s.py.toFixed(2),
        formatNumber(s.value),
        ...scaled,
        s.deltaE.toFixed(2),
        s.flagged ? 1 : 0,
        s.clipped ? 1 : 0,
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

// Several profiles in one long table with a profile column: [{name,
// samples, norm}] (norm and unit as in profileCsv, the same for all).
export function profilesCsv(
  entries: { name: string; samples: ProfileSample[]; norm?: ProfileNorm | null }[],
  unit: ScaleUnit | null = null,
) {
  const lines = [`profile,${profileCsv([], entries[0]?.norm, unit).trim()}`];
  for (const { name, samples, norm } of entries) {
    for (const line of profileCsv(samples, norm, unit).trim().split('\n').slice(1))
      lines.push(`${csvEscape(name)},${line}`);
  }
  return lines.join('\n') + '\n';
}

// Map data files for one panel: the matrix, the long format and each profile.
export function mapPanelFiles(panel: Panel, result: MapResult | null | undefined, base: string) {
  if (!result) return [];
  const files: ZipFile[] = [];
  if (!result.error) {
    files.push({ path: `data/${base}_map.csv`, content: mapMatrixCsv(panel, result as MapField) });
    files.push({ path: `data/${base}_map_long.csv`, content: mapLongCsv([{ panel, result }]) });
  }
  const used = new Set();
  for (const l of panel.map.profiles) {
    const samples = result.profiles?.[l.id];
    if (!Array.isArray(samples)) continue;
    let name = safeFileName(l.name);
    while (used.has(name)) name += '_';
    used.add(name);
    files.push({
      path: `data/${base}_profile_${name}.csv`,
      content: profileCsv(samples, null, lengthPerPixel(panel.scale) ? panel.scale!.unit : null),
    });
  }
  return files;
}

// Unique, file-system safe base names for panels, in panel order.
export function panelFileBases(panels: Panel[]) {
  const used = new Set();
  return panels.map((panel, i) => {
    let base = safeFileName(panel.name);
    while (used.has(base)) base += `_${i + 1}`;
    used.add(base);
    return base;
  });
}

// Heatmap data files for one panel: the matrix and the long format.
export function heatmapPanelFiles(panel: Panel, result: PanelResult | null | undefined, base: string): ZipFile[] {
  if (!result || result.error) return [];
  return [
    { path: `data/${base}.csv`, content: toWideCsv(panel, result as HeatmapResult) },
    { path: `data/${base}_long.csv`, content: toLongCsv([{ panel, result }]) },
  ];
}

// Build the project zip. `JSZip` is the JSZip constructor; `sourceFile` is the
// original upload (File/Blob, may be null); `pagePngs` maps page number to a
// PNG Blob of that rendered page; `files` are extra [{path, content}] entries
// such as data CSVs.
export async function buildProjectZip(
  JSZip: typeof JSZipType,
  {
    project,
    sourceFile,
    pagePngs,
    files = [],
  }: { project: Project; sourceFile: File | null; pagePngs: Map<number, Blob>; files?: ZipFile[] },
) {
  const zip = new JSZip();
  const json = serializeProject(project);
  if (json.source) {
    json.source.originalFile = sourceFile ? `source/${safeFileName(sourceFile.name)}` : null;
    json.source.pageImages = {};
    for (const [page, png] of pagePngs) {
      json.source.pageImages[page] = pageImagePath(page);
      zip.file(pageImagePath(page), png);
    }
    // Readers of the first format only know the image of the current page.
    json.source.pageImage = json.source.pageImages[json.source.page || 1] || null;
  }
  zip.file('project.json', JSON.stringify(json, null, 2));
  zip.file('README.txt', README);
  if (sourceFile) zip.file(json.source!.originalFile as string, sourceFile);
  for (const f of files) zip.file(f.path, f.content);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

// Parse a project zip. Returns {project, pageImages: Map(page → Blob),
// originalFile: {name, blob}|null}.
export async function readProjectZip(JSZip: typeof JSZipType, blob: Blob) {
  const zip = await JSZip.loadAsync(blob);
  const entry = zip.file('project.json');
  if (!entry && zip.file('settings.json'))
    throw new Error('this is a settings zip. Import it under Settings → Import and export.');
  if (!entry) throw new Error('Invalid project zip: project.json not found.');
  let json: Raw;
  try {
    json = JSON.parse(await entry.async('string'));
  } catch {
    throw new Error('Invalid project zip: project.json is not valid JSON.');
  }
  const project = parseProject(json);
  const src = json.source || {};
  const paths = src.pageImages && typeof src.pageImages === 'object' ? { ...src.pageImages } : {};
  if (src.pageImage && !Object.values(paths).includes(src.pageImage)) paths[src.page || 1] = src.pageImage;
  const pageImages = new Map();
  for (const [page, path] of Object.entries(paths)) {
    const file = typeof path === 'string' && zip.file(path);
    if (file) pageImages.set(Number(page), await file.async('blob'));
  }
  const orig = src.originalFile && zip.file(src.originalFile);
  const originalFile = orig
    ? { name: src.fileName || src.originalFile.split('/').pop(), blob: await orig.async('blob') }
    : null;
  return { project, pageImages, originalFile };
}

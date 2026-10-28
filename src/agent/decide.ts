import { isLogScale, isPiecewiseScale, piecewiseScaleFor, SCALES } from '../core/colorbar.ts';
import { detectGridSize, fitCellCounts, rectCorners } from '../core/grid.ts';
import { findColorbars, findTickLabels, snapBlock, snapEdges } from '../core/locate.ts';
import type {
  ActionArgs,
  ActionSpec,
  Box,
  CellCounts,
  DecisionBox,
  DecisionQuestion,
  JsonSchema,
  LlmTool,
  PanelSnapshot,
  PixelImage,
  Point,
  ViewFrame,
} from '../types/index.ts';
import { RUNNER_TOOLS } from './llm.ts';
import { AGENT_ACTIONS, validate } from './schema.ts';

const SCALE_NAMES = SCALES;

// Shapes used by several functions below.
type Side = 'left' | 'right' | 'above' | 'below';
type Axis = 'row' | 'col';
/** A fraction span [from, to] of a box along an axis, 0–1. */
type Span = [number, number];
/** A tick as the checks see it: position t along the bar and printed value. */
interface TickTV {
  t: number;
  value: number;
}
/** A tick-label box of findTickLabels: where it projects on the strip, and a note on odd ones. */
interface TickMark {
  at: Point;
  box?: Box;
  note?: string;
}
/** A colorbar strip found on the page (stripCandidate). */
export interface StripInfo {
  bar: Box;
  labelSide: string | null;
  labels: number;
  labelsAt?: Point[];
}
/** A candidate with its place relative to the cells (chooseColorbar). */
interface PlacedStrip extends StripInfo {
  at: { side: Side; gap: number };
}
/** A panel as gridNeighbours and regridOthers see it. */
export interface PlacedPanel {
  id: string;
  name?: string;
  cells: Box;
  rows: number;
  cols: number;
  unsure?: { row?: boolean; col?: boolean };
}
/** What gridNeighbours lends to planCounts. */
export interface Neighbours {
  col?: { count: number; id: string; name?: string };
  row?: { count: number; id: string; name?: string };
  rowCell?: number;
  colCell?: number;
  cell?: number;
}
/** The fields of fitCellCounts' result that planCounts reads (all optional: fields by axis name). */
export interface CountFit {
  rows?: number;
  cols?: number;
  rowScore?: number;
  colScore?: number;
  rowAlt?: number | null;
  colAlt?: number | null;
  rowAltScore?: number;
  colAltScore?: number;
  rowSize?: number;
  colSize?: number;
  rowReason?: string;
  colReason?: string;
  rowSpan?: number[];
  colSpan?: number[];
}
/** The fields of detectGridSize's result that planCounts reads. */
export interface CountDetection {
  rows: number;
  cols: number;
  rowConfidence?: number;
  colConfidence?: number;
}
/** planCounts' result. */
export interface CountPlan {
  rows: number;
  cols: number;
  span: Partial<Record<Axis, Span>>;
  alt: Partial<Record<Axis, number>>;
  unsure: { row: boolean; col: boolean };
  notes: string[];
}

// Pure parts of "agent decision" mode (agent/decision-tools.js runs them).
// The LLM reads the page and writes short descriptions; a decision model
// (Jev by default, through OpenRouter's Decisions API) answers typed
// questions about one heatmap at a time: where its cells are (box), which
// side its colorbar is on (choice) and where that colorbar is (box). Code
// snaps the rough boxes to pixels (core/locate.js) and the app counts rows
// and columns itself (core/grid.js fitCellCounts). Measured on example.pdf
// page 5 (10 heatmaps): box edges come back with two decimals, so a
// page-wide box is ~20 px off and a second box on a crop ~5 px; after
// snapping, all 10 cell blocks and colorbars were exact. Jev could not box
// small tick-label text or count cells reliably, so tick labels are found
// by code and read by the LLM, and counts come from the pixels.

export const DEFAULT_DECISION_MODEL = 'typesafe/jev-1.14';

const SYSTEM_PROMPT = `You are the extraction agent of Colormeris, a tool that turns colors in scientific figures back into numbers. Your job: find every numerical heatmap on the pages you are given and get one calibrated panel per heatmap. You work with a decision model that locates things in page images; the app snaps boxes to pixels, finds colorbars and tick labels, and counts rows and columns. You read text, describe targets and choose. Give page coordinates only where a tool asks for a rough box.

What counts as a heatmap: a block of colored cells whose colors stand for numbers on a colorbar (bordered or not). A strip of cells with its own colorbar (e.g. a -log10(p) row above a heatmap) is a heatmap of its own. Skip blocks without a colorbar, categorical group strips (a few flat colors with a legend of names), dendrograms, photos, plots and tables. Separately framed blocks that share one colorbar are one panel each.

For each page:
1. Look at the page image. List in your message EVERY heatmap with its figure label and which colorbar it uses.
2. Call locate_heatmap once per heatmap, all in the same turn. name: the label as printed (e.g. "Fig 2f", else "f", or "f top strip"); never the page number. description: what singles it out: panel letter, title, position (e.g. "upper left, right of panel e"), first row label.
3. Each result has an image: magenta grid lines as placed, the orange colorbar line, and the colorbar's tick labels in blue boxes numbered 1, 2, 3… Then, in one turn per heatmap:
   - set_ticks: the printed value of each numbered box that is a tick label, as {mark, value}. Skip boxes on anything else (a title, a ×10^n note: apply that multiplier to the values instead). When the boxes are missing or wrong, give {t, value} instead: t is where the label sits along the colored strip, 0 at its top (vertical bar) or left (horizontal) end, 1 at the other. Scale: leave it out unless the labels grow by constant factors (1, 10, 100: "log10"); the app handles binned bars and uneven ticks by itself.
   - set_labels: row labels top to bottom and column labels left to right, exactly as printed. Labels may cover groups of cells; that is fine.
4. When the result lists colorbar candidates (letters A, B… on a page image) instead of one colorbar, pick this heatmap's with use_colorbar {candidate}; when it shares the colorbar of a panel you already calibrated, use_colorbar {fromPanel} copies it with its ticks. If its colorbar is not found at all, use_colorbar {box} with the strip's rough extent from the page rulers.
5. set_ticks returns the app's check and an image: each orange tick dot with its value should sit level with its printed label. When the cells show printed numbers, read 3–5 spread over the heatmap (the lowest and highest among them) and call check_printed after set_ticks; the colors stay the values, the numbers only check them. If the check fails, find the cause (a misread or misassigned tick value, the wrong colorbar or heatmap; correctly read ticks at uneven places along a smooth bar need set_colorbar_scale piecewise, which checks again) and fix it once. Cells whose colors are not on the colorbar (gray "ND" cells, a black diagonal) are left empty, and a binned colorbar gives each cell its bin's middle value: both are expected, not failures. Cells paler or darker than the bar's end are only bounds; mention it in finish.
6. Check the grid against the image: every cell between magenta lines, one cell per gap, outer lines on the cells' edges. If the count is wrong (lines merge replicate cells or split them, or a strip without borders), call correct_grid_size with the count you see (cell edges, or labels when there are no edges) and why. If the outer lines miss the cells' edges, add box: the cells' rough extent read from the page rulers (view_page if needed); the app moves each edge at most a few px. Only when the grid sits on the wrong heatmap, call locate_heatmap again with panelId and box.
7. When every heatmap of every page is done, call finish with one line per panel and anything a human should check. Keep your messages short.`;

// Agent actions the LLM may call in this mode. The app counts rows and
// columns; the LLM may only correct a count with correct_grid_size (with a
// reason), not set a grid itself: locate_heatmap places grids.
export const DECISION_LLM_ACTIONS = ['go_to_page', 'select_panel', 'rename_panel', 'remove_panel', 'set_labels', 'set_colorbar', 'add_tick', 'remove_tick', 'set_colorbar_scale', 'undo'];

const panelId: JsonSchema = { type: 'string', description: 'Panel to act on. Defaults to the active panel.' };
const roughBox = (description: string): JsonSchema => ({ type: 'object', properties: { x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' } }, required: ['x0', 'y0', 'x1', 'y1'], description });
const DECISION_QUESTION: JsonSchema = {
  type: 'object',
  properties: {
    type: { enum: ['noul', 'choice', 'score', 'box'] },
    instructions: { type: 'string', description: 'The question, or for box a description of the one target to find.' },
    criteria: { description: 'noul: {true, false} descriptions; choice: {option: description}; score: ordered list of levels; box: none.' },
  },
  required: ['type', 'instructions'],
};

// Tools handled by agent/decision-tools.js (plus view_page, view_pages_overview and finish).
export const DECISION_TOOLS: Record<string, ActionSpec> = {
  locate_heatmap: {
    description: 'Find one heatmap with the decision model and calibrate a panel for it: the grid on its cells (rows and columns counted by the app) and its colorbar. Uses a new panel unless panelId is given or the active panel is still empty. Returns the placement and an image with numbered tick-label boxes, or lettered colorbar candidates when it cannot tell which colorbar is this heatmap\'s.',
    args: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, description: 'Figure label, e.g. "Fig 2f". Becomes the panel name.' },
        description: { type: 'string', minLength: 3, description: 'What singles this heatmap out on the page: panel letter, title, position, first row label.' },
        panelId: { type: 'string', description: 'Re-locate this panel instead of using a new one.' },
        box: roughBox('Only when a first locate found the wrong heatmap: the cells\' rough extent in page pixels, read from the page image\'s rulers. The decision model is not asked; each edge moves at most a few px onto the cells\' edge.'),
      },
      required: ['name', 'description'],
    },
  },
  set_ticks: {
    description: 'Set the colorbar ticks (replaces the panel\'s ticks), then check the extraction; returns the check and an image of the ticks. Give each tick by its numbered tick-label box (mark), or, when the boxes are missing or wrong, by its place along the colored strip (t). Ticks snap to tick marks. Unless you give a scale, the app picks one that fits: for a binned colorbar, and piecewise for evenly stepped labels at uneven places along a smooth bar.',
    args: {
      type: 'object',
      properties: {
        panelId,
        ticks: {
          type: 'array',
          minItems: 2,
          items: {
            type: 'object',
            properties: {
              mark: { type: 'integer', minimum: 1, description: 'Number of the blue box.' },
              t: { type: 'number', minimum: 0, maximum: 1, description: 'Instead of mark: where the label sits along the strip, 0 at its top end (vertical bar) or left end (horizontal bar), 1 at the other end.' },
              value: { type: 'number', description: 'The printed label as a number, with any ×10^n multiplier applied.' },
            },
            required: ['value'],
          },
        },
        scale: { enum: SCALE_NAMES, description: 'Leave out unless the labels grow by constant factors (log10). piecewise: uneven tick values interpolated between neighbours.' },
      },
      required: ['ticks'],
    },
  },
  use_colorbar: {
    description: 'Give a panel its colorbar: one of the lettered candidates from locate_heatmap (candidate), the colorbar of another panel with its ticks and scale (fromPanel: blocks sharing one colorbar), or a strip at a rough box in page pixels (box) when none was found. Returns numbered tick-label boxes for set_ticks (except with fromPanel, which checks the panel).',
    args: {
      type: 'object',
      properties: {
        panelId,
        candidate: { type: 'string', minLength: 1, maxLength: 2, description: 'Letter of a colorbar candidate, e.g. "B".' },
        fromPanel: { type: 'string', description: 'Id of a panel whose colorbar this heatmap shares.' },
        box: roughBox('The colored strip\'s rough extent in page pixels, from the page rulers.'),
      },
    },
  },
  correct_grid_size: {
    description: 'Correct the app\'s row and column count of a panel when the image shows it is wrong: magenta lines that merge or split cells, or a strip without cell borders. Count cell edges in the image; count labels only where there are no edges (one label can cover several replicate cells). With box (the cells\' rough extent from the page rulers) the grid\'s outer edges also move onto the cells (at most a few px each); without it the corners stay. Then checks the extraction.',
    args: {
      type: 'object',
      properties: {
        panelId,
        rows: { type: 'integer', minimum: 1, maximum: 500 },
        cols: { type: 'integer', minimum: 1, maximum: 500 },
        reason: { type: 'string', minLength: 3, description: 'What in the image shows the count, e.g. "3 replicate cells under each column label".' },
        box: roughBox('Only when the outer grid lines miss the cells: the cells\' rough extent in page pixels.'),
      },
      required: ['rows', 'cols', 'reason'],
    },
  },
  check_printed: {
    description: 'Cross-check a calibrated panel against numbers printed in its cells: give 3–5 cells spread over the heatmap (with the lowest and highest printed numbers) and the numbers as printed. The app compares them with the values it extracted from the colors and says whether they agree; a disagreement that grows with the value or shifts all of them points at wrong tick values or colorbar ends. The colors stay the values.',
    args: {
      type: 'object',
      properties: {
        panelId,
        cells: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: {
            type: 'object',
            properties: {
              row: { type: 'integer', minimum: 1, description: 'Row number, 1 at the top.' },
              col: { type: 'integer', minimum: 1, description: 'Column number, 1 at the left.' },
              value: { type: 'number', description: 'The number printed in that cell.' },
            },
            required: ['row', 'col', 'value'],
          },
        },
      },
      required: ['cells'],
    },
  },
  check_panel: {
    description: 'Check a panel again: whether it is ready, whether its tick values fit the scale, and how many cells are far from the colorbar\'s colors, off it or past its ends.',
    args: { type: 'object', properties: { panelId } },
  },
  ask: {
    description: 'Ask the decision model your own questions about one region of the current page (no rulers in its image). Box answers come back in page pixels. Use it rarely, for one heatmap at a time.',
    args: {
      type: 'object',
      properties: {
        region: roughBox('Area in page pixels. Omit for the whole page.'),
        overlay: { enum: ['none', 'calibration', 'reconstruction'] },
        questions: { type: 'object', description: 'Up to 6 questions by id: {id: {type, instructions, criteria}}.' },
      },
      required: ['questions'],
    },
  },
};

// Models send null for optional arguments they do not use ({mark: 2, t:
// null}); those mean "not given" (as normalizeArgs does for the agent API).
export function cleanDecisionArgs(name: string, args: ActionArgs | null): ActionArgs | null {
  const drop = (o: ActionArgs): ActionArgs => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null));
  const out = args && typeof args === 'object' ? drop(args) : args;
  if (name === 'set_ticks' && Array.isArray(out?.ticks)) out.ticks = out.ticks.map((k: unknown) => (k && typeof k === 'object' ? drop(k as ActionArgs) : k));
  return out;
}

export function validateDecisionTool(name: string, args: ActionArgs) {
  const errs = validate(DECISION_TOOLS[name].args, args);
  if (name === 'ask' && !errs.length) {
    const qs = Object.entries(args.questions as Record<string, Record<string, unknown>>);
    if (!qs.length || qs.length > 6) errs.push('args.questions: give 1 to 6 questions');
    for (const [id, q] of qs) {
      errs.push(...validate(DECISION_QUESTION, q, `args.questions.${id}`));
      if (q.type === 'score' && !Array.isArray(q.criteria)) errs.push(`args.questions.${id}.criteria: a score needs a list of levels`);
      if (q.type === 'choice' && (!q.criteria || typeof q.criteria !== 'object' || Array.isArray(q.criteria))) errs.push(`args.questions.${id}.criteria: a choice needs {option: description}`);
    }
  }
  if (name === 'set_ticks' && !errs.length) {
    (args.ticks as { mark?: unknown; t?: unknown }[]).forEach((k, i) => {
      if ((k.mark === undefined) === (k.t === undefined)) errs.push(`args.ticks[${i}]: give exactly one of mark or t`);
    });
  }
  if (name === 'use_colorbar' && !errs.length && ['candidate', 'fromPanel', 'box'].filter((k) => args[k] !== undefined).length !== 1) {
    errs.push('args: give exactly one of candidate, fromPanel or box');
  }
  return errs;
}

// Tool definitions in the SDK's chat format.
export function decisionLlmTools() {
  const fn = (name: string, description: string, parameters: JsonSchema): LlmTool => ({ type: 'function', function: { name, description, parameters } });
  return [
    ...Object.entries(DECISION_TOOLS).map(([n, t]) => fn(n, t.description, t.args)),
    ...DECISION_LLM_ACTIONS.map((n) => fn(n, AGENT_ACTIONS[n].description, AGENT_ACTIONS[n].args)),
    ...['view_page', 'view_pages_overview', 'finish'].map((n) => fn(n, RUNNER_TOOLS[n].description, RUNNER_TOOLS[n].args)),
  ];
}

// ---------------------------------------------------------------- questions

// Each request is about one heatmap; descriptions come from the LLM.
const questions: Record<string, (description?: string) => Record<string, DecisionQuestion>> = {
  // On the whole page: roughly where the heatmap is.
  find: (description) => ({
    present: { type: 'noul', instructions: `Is there a heatmap (a grid of colored cells) on this page matching: ${description}?` },
    cells: { type: 'box', instructions: `the grid of colored cells of the heatmap described as: ${description}` },
  }),
  // On a crop around it: the cells alone.
  cells: () => ({
    cells: { type: 'box', instructions: 'the rectangle of colored heatmap cells in the middle of the image (only the colored cells: not the row labels, column labels, title or colorbar)' },
  }),
  side: () => ({
    side: {
      type: 'choice',
      instructions: 'Where is the colorbar (the strip of graded color with numbers that shows the color scale) of the heatmap in the middle of the image?',
      criteria: { right: 'to the right of the cells', left: 'to the left of the cells', above: 'above the cells', below: 'below the cells', none: 'there is no colorbar' },
    },
  }),
  // On the strip of page beside the cells, with the cells left out.
  bar: () => ({
    bar: { type: 'box', instructions: 'the colorbar: the long narrow strip of graded color, from one end to the other (only the colored strip, not its tick labels or title)' },
  }),
};

// Whether a strip found on `side` of the cells can be their colorbar:
// close to them (a neighbour's colorbar is further away), running along
// them for at least half its length, a strip rather than a line, and with its tick labels (`labelSide`
// from findTickLabels, if any) on its far side: a colorbar's labels face
// away from its own heatmap. On example.pdf page 3, panel h's colorbar sits
// 72 px left of panel i with its labels towards i. `reach` (a share of the
// cells' size across the gap) is 0.25 here; nearCheck allows more.
export function besideCheck(cells: Box, bar: Box, side: string, labelSide: string | null = null, reach: number | null = null) {
  if (labelSide && labelSide !== side) return false;
  const vertical = side === 'left' || side === 'right';
  const gap = side === 'right' ? bar.x0 - cells.x1 : side === 'left' ? cells.x0 - bar.x1 : side === 'below' ? bar.y0 - cells.y1 : cells.y0 - bar.y1;
  reach ??= Math.max(40, 0.25 * (vertical ? cells.x1 - cells.x0 : cells.y1 - cells.y0));
  const [a0, a1, c0, c1] = vertical ? [bar.y0, bar.y1, cells.y0, cells.y1] : [bar.x0, bar.x1, cells.x0, cells.x1];
  const overlap = Math.min(a1, c1) - Math.max(a0, c0);
  // A strip at least 4 px thick and 15% as long as the cells (not a line or
  // speck; a 32-column heatmap had a colorbar 24% as long as its width).
  const thick = vertical ? bar.x1 - bar.x0 : bar.y1 - bar.y0;
  return gap >= -2 && gap <= reach && overlap >= 0.5 * (a1 - a0) && thick >= 4 && a1 - a0 >= 0.15 * (c1 - c0);
}

// A colorbar further out but still the cells' own: up to 60% of their
// longer side away, labels on either side. A narrow tall heatmap had its
// colorbar 140 px to the right (0.8 of its width); another had its tick
// labels facing the cells.
export function nearCheck(cells: Box, bar: Box, side: string) {
  return besideCheck(cells, bar, side, null, Math.max(80, 0.6 * Math.max(cells.x1 - cells.x0, cells.y1 - cells.y0)));
}

// Which side of the cells a strip lies on, and how far: the axis with the
// larger gap wins for a strip off a corner. Null when they overlap.
export function sideOf(cells: Box, bar: Box): { side: Side; gap: number } | null {
  const dx: [Side, number] | null = bar.x0 >= cells.x1 - 2 ? ['right', bar.x0 - cells.x1] : bar.x1 <= cells.x0 + 2 ? ['left', cells.x0 - bar.x1] : null;
  const dy: [Side, number] | null = bar.y0 >= cells.y1 - 2 ? ['below', bar.y0 - cells.y1] : bar.y1 <= cells.y0 + 2 ? ['above', cells.y0 - bar.y1] : null;
  const [side, gap] = !dx ? dy || [null, -1] : !dy ? dx : dx[1] >= dy[1] ? dx : dy;
  return side ? { side, gap } : null;
}

// Share of ink (off the page color) in the bands 4–10 px outside each
// long side of a strip (or, `across`, past each end), the larger of the
// two; pixels in `exclude` boxes (known heatmap cells) are skipped. A
// colorbar stands on the page, with at most a frame line, tick marks and
// labels beside it and nothing past its ends; a run of cells inside a
// heatmap not located yet has more cells past its ends. The page color is
// the median of the page's edge pixels.
export function flankInk(img: PixelImage, bar: Box, exclude: Box[] = [], across = false) {
  const px = (x: number, y: number): number[] => {
    const i = (Math.round(y) * img.width + Math.round(x)) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  };
  const edge: number[][] = [];
  const step = Math.max(1, Math.floor((img.width + img.height) / 400));
  for (let x = 0; x < img.width; x += step) edge.push(px(x, 0), px(x, img.height - 1));
  for (let y = 0; y < img.height; y += step) edge.push(px(0, y), px(img.width - 1, y));
  const med = [0, 1, 2].map((c) => edge.map((p) => p[c]).sort((a, b) => a - b)[edge.length >> 1]);
  const skip = (x: number, y: number) => exclude.some((b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1);
  // `across`: the bands beyond the strip's two ends instead of its sides.
  const vertical = (bar.y1 - bar.y0 >= bar.x1 - bar.x0) !== across;
  const [a0, a1] = vertical ? [bar.y0, bar.y1] : [bar.x0, bar.x1];
  const ends = vertical ? [bar.x0, bar.x1] : [bar.y0, bar.y1];
  const lim = vertical ? img.width : img.height;
  let worst = 0;
  for (const [from, dir] of [[ends[0], -1], [ends[1] - 1, 1]] as [number, number][]) {
    let ink = 0;
    let n = 0;
    for (let d = 4; d <= 10; d += 2) {
      const b = from + dir * d;
      if (b < 0 || b >= lim) continue;
      for (let a = a0; a < a1; a += Math.max(1, (a1 - a0) / 60)) {
        const [x, y] = vertical ? [b, a] : [a, b];
        if (skip(x, y)) continue;
        n++;
        if (Math.max(...px(x, y).map((v, c) => Math.abs(v - med[c]))) > 40) ink++;
      }
    }
    if (n) worst = Math.max(worst, ink / n);
  }
  return worst;
}

const area = (b: Box) => (b.x1 - b.x0) * (b.y1 - b.y0);
const holds = (a: Box, b: Box) => a.x0 <= b.x0 + 3 && a.y0 <= b.y0 + 3 && a.x1 >= b.x1 - 3 && a.y1 >= b.y1 - 3;
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// The cells from the decision model's two boxes, snapped to pixels
// (core/locate.js snapBlock): `rough` on the whole page, `boxed` on a
// crop around it. A crop box on a pale edge column has no solid core to
// snap from; the page-wide box then still reaches the block. A short crop
// box can also stop the snap at a pale row (the 24h cytokine heatmap: 6 of
// 32 rows); a page-wide snap that holds it and is much larger then wins,
// unless it outgrew Jev's page box (a neighbouring heatmap joined in). The
// other way round, a crop snap that holds the page-wide one and is far
// larger than Jev's page box took in a block next to it (a strip and the
// block 20 px below it). A snap far smaller than Jev's page box caught one
// corner of the heatmap (once on a 12 × 32 heatmap: 2 × 2 cells):
// `partial`, and the LLM re-locates. A snap that lost more than 15% of
// the crop box, or moved an edge more than 8% of it inward, may have
// stopped at pale cells (t16, t18: 22% and 65% of the box): the crop box
// with only its edges refined (snapEdges) is tried too and wins when its
// cells fit an even grid clearly better (fitQuality) and its edges were
// found on the pixels. Returns {cells (null
// when nothing snapped), partial, edges (true when the refined box won)}.
export function snapCells(img: PixelImage, rough: Box, boxed: Box) {
  const near = snapBlock(img, boxed);
  const wide = snapBlock(img, rough);
  let cells = near || wide;
  if (near && wide && holds(wide, near) && area(near) < 0.6 * area(wide) && area(wide) < 1.5 * area(rough)) cells = wide;
  if (near && wide && holds(near, wide) && area(near) > 1.5 * area(rough) && area(wide) <= 1.5 * area(rough)) cells = wide;
  let edges = false;
  if (cells && shrunk(cells, boxed)) {
    // (Only a box whose edges found the cells' edges: at least 3 of them
    // moved. One that stayed put is the crop box with its white margin.)
    let alt = snapEdges(img, boxed);
    if (alt && (['x0', 'y0', 'x1', 'y1'] as const).filter((k) => Math.abs(alt![k] - boxed[k]) >= 1).length < 3) alt = null;
    const [q, qa] = [fitQuality(img, cells), alt && fitQuality(img, alt)];
    // It must add whole cells: each side it moves out by more than 3 px
    // gains half a cell or more (t10: 12 px of row labels past 42 px cells
    // fit as well and are no cells).
    const cellsOnly = (b: Box) => (['x0', 'x1', 'y0', 'y1'] as const).every((k) => {
      const out = k.endsWith('0') ? cells![k] - b[k] : b[k] - cells![k];
      return out <= 3 || out >= 0.5 * (k[0] === 'x' ? q.colSize : q.rowSize);
    });
    if (qa && qa.min >= FAIR_FIT && qa.mean >= q.mean + 0.1 && cellsOnly(alt!)) [cells, edges] = [alt!, true];
  }
  return { cells, partial: !!cells && area(cells) < 0.3 * area(rough), edges };
}

// Whether a snap lost much of a box: under 85% of its area, or an edge
// more than 8% of the box inside it.
function shrunk(cells: Box, box: Box) {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const inward = Math.max((cells.x0 - box.x0) / w, (box.x1 - cells.x1) / w, (cells.y0 - box.y0) / h, (box.y1 - cells.y1) / h);
  return area(cells) < 0.85 * area(box) || inward > 0.08;
}

// How well a box of cells fits an even grid (fitCellCounts' scores on
// both axes): {min, mean, rowSize, colSize}.
function fitQuality(img: PixelImage, b: Box) {
  const f = fitCellCounts(img, rectCorners({ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }));
  return { min: Math.min(f.rowScore, f.colScore), mean: (f.rowScore + f.colScore) / 2, rowSize: f.rowSize, colSize: f.colSize };
}

// A colorbar candidate {bar, labelSide, labels} for a strip, or null.
// A strip needs the page past its ends and beside it: a run of cells in a
// heatmap not located yet looks like a binned bar (test-1's average rows,
// test-10's main heatmap seen from the strip above it), with more cells
// past its ends (ink 0.95–1 there, 0–0.11 past a real colorbar's ends on
// 14 figures). A strip from the pixels alone (`minLabels` 2) also needs
// two tick labels; one the decision model boxed may have none found.
export function stripCandidate(img: PixelImage, bar: Box | null | undefined, exclude: Box[] = [], groups: Box[] = [], minLabels = 0): StripInfo | null {
  if (!bar || exclude.some((c) => overlaps(c, bar)) || groups.some((g) => overlaps(g, bar))) return null;
  const labels = findTickLabels(img, bar, { exclude });
  if (labels.marks.length < minLabels || flankInk(img, bar, exclude, true) > 0.5 || flankInk(img, bar, exclude) > 0.85) return null;
  return { bar: { x0: bar.x0, y0: bar.y0, x1: bar.x1, y1: bar.y1 }, labelSide: labels.side, labels: labels.marks.length, labelsAt: labels.marks.map((m) => m.at) };
}

// Colorbar candidates on the page from the pixels alone (findColorbars,
// with the known heatmap cells in `exclude`), and the categorical group
// strips, which stay out even when the decision model boxes one.
export function pageColorbars(img: PixelImage, exclude: Box[] = []) {
  const found = findColorbars(img, { exclude });
  const groups = found.filter((b) => b.kind === 'categorical');
  const candidates: StripInfo[] = [];
  for (const bar of found) {
    if (bar.kind === 'categorical' || candidates.some((c) => overlaps(c.bar, bar))) continue;
    const c = stripCandidate(img, bar, exclude, [], 2);
    if (c) candidates.push(c);
  }
  return { candidates, groups };
}

// What the LLM is told about a colorbar's numbered tick-label boxes
// (findTickLabels marks, with `note` on odd ones): how many there are, so
// it never gives a box number that does not exist (t10: 5 ticks read off 4
// boxes), which ones look odd, and whether the strip was extended to a
// label past its pale end.
export function tickBoxesText(marks: { note?: string }[], { extended = false }: { extended?: boolean } = {}) {
  if (!marks.length) return 'No tick labels were found beside it: give ticks to set_ticks as {t, value}.';
  const n = marks.length;
  const odd = marks.map((m, i) => (m.note ? `box ${i + 1} is ${m.note}` : null)).filter(Boolean);
  return [
    `${n} tick-label box${n === 1 ? '' : 'es'} found, numbered ${n === 1 ? '1' : `1–${n}`} in reading order; there are no others. A printed tick label without a box goes to set_ticks as {t, value}.`,
    odd.length ? `Check: ${odd.join('; ')}.` : '',
    extended ? 'The strip fades into the page at one end; the colorbar line was extended to the tick label just past it.' : '',
  ].filter(Boolean).join(' ');
}

const LETTERS = 'ABCDEFGHIJ';
const MAX_CANDIDATES = 6;

// Picks a panel's colorbar among strips found on the page (`candidates`:
// [{bar, labelSide, labels (count)}], from the decision model's box and
// findColorbars). Exactly one strip beside the cells (labels on its far
// side) wins; else exactly one near them (nearCheck). With several, or
// none near, the LLM chooses: `list` holds them lettered, strips with
// tick labels first, then nearest first.
// A lone strip on the page is taken even far away (one colorbar shared by
// several blocks). `grid` ({rows, cols}, optional): a strip whose "tick
// labels" are the heatmap's own column or row labels (one per column, each
// on a column's middle: t16's dashed outline under the cells and its 13
// rotated column labels) is left out. Returns {bar, how: 'beside' |
// 'near' | 'only'} or {list: [{letter, bar, side, gap, labels}]}.
export function chooseColorbar(cells: Box, candidates: StripInfo[], grid: { rows: number; cols: number } | null = null) {
  const placed = candidates.map((c) => ({ ...c, at: sideOf(cells, c.bar) })).filter((c) => c.at && !(grid && cellLabels(cells, c as PlacedStrip, grid))) as PlacedStrip[];
  // A strip as long as the cells, end to end, without two tick labels is
  // a group or label strip drawn along them (t9's "Group" strip above the
  // cells); it is never taken without the LLM. (A colorbar may be exactly
  // as long as the cells too, t3's, but with its numbers.)
  const alongCells = (c: PlacedStrip) => {
    const v = c.at.side === 'left' || c.at.side === 'right';
    const [a0, a1, c0, c1] = v ? [c.bar.y0, c.bar.y1, cells.y0, cells.y1] : [c.bar.x0, c.bar.x1, cells.x0, cells.x1];
    const tol = Math.max(4, 0.02 * (c1 - c0));
    return Math.abs(a0 - c0) <= tol && Math.abs(a1 - c1) <= tol;
  };
  // A strip without tick labels is not taken by itself while another one
  // has them: the decision model once boxed a row of a heatmap not
  // located yet as the colorbar.
  const numbered = (c: PlacedStrip) => (c.labels || 0) >= 2;
  const pick = (c: PlacedStrip, how: string) => (numbered(c) || !placed.some(numbered) ? { bar: c.bar, how } : null);
  const eligible = placed.filter((c) => !(alongCells(c) && !numbered(c)));
  const beside = eligible.filter((c) => besideCheck(cells, c.bar, c.at.side, c.labels ? c.labelSide : null));
  let auto: { bar: Box; how: string } | null = null;
  if (beside.length === 1) auto = pick(beside[0], 'beside');
  else if (!beside.length) {
    const near = eligible.filter((c) => nearCheck(cells, c.bar, c.at.side));
    if (near.length === 1) auto = pick(near[0], 'near');
    else if (!near.length && eligible.length === 1) auto = pick(eligible[0], 'only');
  }
  if (auto) return auto;
  // Strips with tick labels first (a colorbar has numbers), then nearest.
  const labelled = (c: PlacedStrip) => (numbered(c) ? 0 : 1);
  const list = placed
    .sort((a, b) => labelled(a) - labelled(b) || a.at.gap - b.at.gap)
    .slice(0, MAX_CANDIDATES)
    .map((c, i) => ({ letter: LETTERS[i], bar: c.bar, side: c.at.side, gap: Math.round(c.at.gap), labels: c.labels || 0 }));
  return { list };
}

// Whether a strip's labels (`labelsAt`, from stripCandidate) are the
// cells' column labels (strip above or below) or row labels (left or
// right): as many as columns (rows), at least 3, each within a quarter
// cell of a column's (row's) middle.
export function cellLabels(cells: Box, c: PlacedStrip, grid: { rows: number; cols: number }) {
  const v = c.at.side === 'left' || c.at.side === 'right';
  const n = v ? grid.rows : grid.cols;
  const at = c.labelsAt || [];
  if (n < 3 || at.length !== n) return false;
  const [a0, a1] = v ? [cells.y0, cells.y1] : [cells.x0, cells.x1];
  const pitch = (a1 - a0) / n;
  return at.every((p, i) => Math.abs((v ? p.y : p.x) - (a0 + (i + 0.5) * pitch)) <= 0.25 * pitch);
}

// A box answer (fractions of the image) → page pixels. `frame` describes
// the image: page point (x0, y0) at image pixel (0, 0), `scale` image
// pixels per page pixel, `width` × `height` image pixels.
export function boxToPage(box: DecisionBox, frame: ViewFrame) {
  const f = (v: number) => Math.round(v * 10) / 10;
  return {
    x0: f(frame.x0 + (box.left * frame.width) / frame.scale),
    y0: f(frame.y0 + (box.top * frame.height) / frame.scale),
    x1: f(frame.x0 + (box.right * frame.width) / frame.scale),
    y1: f(frame.y0 + (box.bottom * frame.height) / frame.scale),
  };
}

// A box grown by `f` of its size plus `px` on every side, kept on the page.
export function growBox(b: Box, f: number, px: number, width: number, height: number) {
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  return { x0: Math.max(0, b.x0 - w * f - px), y0: Math.max(0, b.y0 - h * f - px), x1: Math.min(width, b.x1 + w * f + px), y1: Math.min(height, b.y1 + h * f + px) };
}

// The strip of page beside the cells where a colorbar on `side` must be,
// leaving the cells out so the box question cannot pick them.
export function besideBox(cells: Box, side: string, width: number, height: number) {
  const w = cells.x1 - cells.x0;
  const h = cells.y1 - cells.y0;
  const reachX = Math.max(80, 0.6 * w);
  const reachY = Math.max(80, 0.6 * h);
  const b =
    side === 'right' ? { x0: cells.x1 + 1, y0: cells.y0 - 0.25 * h, x1: cells.x1 + reachX, y1: cells.y1 + 0.25 * h }
    : side === 'left' ? { x0: cells.x0 - reachX, y0: cells.y0 - 0.25 * h, x1: cells.x0 - 1, y1: cells.y1 + 0.25 * h }
    : side === 'above' ? { x0: cells.x0 - 0.25 * w, y0: cells.y0 - reachY, x1: cells.x1 + 0.25 * w, y1: cells.y0 - 1 }
    : { x0: cells.x0 - 0.25 * w, y0: cells.y1 + 1, x1: cells.x1 + 0.25 * w, y1: cells.y1 + reachY };
  return { x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(width, b.x1), y1: Math.min(height, b.y1) };
}

// Colorbar line from the strip's box: along its long axis through the
// middle, low end first (bottom of a vertical bar, left of a horizontal
// one). Only a convention: the tick values set the direction.
export function barLine(bar: Box) {
  const mx = (bar.x0 + bar.x1) / 2;
  const my = (bar.y0 + bar.y1) / 2;
  return bar.y1 - bar.y0 >= bar.x1 - bar.x0
    ? { start: { x: mx, y: bar.y1 - 1 }, end: { x: mx, y: bar.y0 } }
    : { start: { x: bar.x0, y: my }, end: { x: bar.x1 - 1, y: my } };
}

// The LLM gives t from the top (vertical) or left (horizontal) end of the
// strip; the colorbar line may run either way. → t along start → end.
export function tFromTopLeft(start: Point, end: Point, t: number) {
  const vertical = Math.abs(end.y - start.y) >= Math.abs(end.x - start.x);
  const startFirst = vertical ? start.y <= end.y : start.x <= end.x;
  return startFirst ? t : 1 - t;
}

// Ticks [{t, value}] that do not lie on one straight line along the bar
// (in log10 for a log bar): the worst one's index and its miss as a share
// of the value range, or null with fewer than 3 ticks. A misread label
// ("25" for "2.5") or a value given to the wrong box shows up here. A
// piecewise scale promises no line (a binned bar labelled 1e4, 2e4, 2e5 at
// even steps), so it is not checked. (A check of the reconstruction cannot
// see tick values: it repaints colors by position along the bar. Jev also
// judged correct reconstructions as wrong, 0.27–0.45 on example.pdf page
// 5, so it is not asked.)
export function tickMisfit(ticks: TickTV[], scale = 'linear') {
  if (ticks.length < 3 || isPiecewiseScale(scale)) return null;
  const v = ticks.map((k) => (isLogScale(scale) ? Math.log10(k.value) : k.value));
  if (v.some((x) => !Number.isFinite(x))) return null;
  const n = ticks.length;
  const mt = ticks.reduce((a, k) => a + k.t, 0) / n;
  const mv = v.reduce((a, x) => a + x, 0) / n;
  let stt = 0;
  let stv = 0;
  ticks.forEach((k, i) => {
    stt += (k.t - mt) ** 2;
    stv += (k.t - mt) * (v[i] - mv);
  });
  if (!stt) return null;
  const slope = stv / stt;
  const range = Math.max(...v) - Math.min(...v) || 1;
  let worst = { index: 0, miss: 0 };
  ticks.forEach((k, i) => {
    const miss = Math.abs(v[i] - (mv + slope * (k.t - mt))) / range;
    if (miss > worst.miss) worst = { index: i, miss };
  });
  return worst;
}

const MISFIT = 0.03; // tick off the line by this share of the range fails the check

// The scale for a binned colorbar when the LLM gave none: linear or log10
// when the ticks lie on that line, else the piecewise scale for them
// (uneven labels at bin steps). Null keeps the panel's scale.
export function scaleForBins(ticks: TickTV[], current = 'linear') {
  if (ticks.length < 3) return null;
  const fits = (scale: string) => (tickMisfit(ticks, scale)?.miss ?? 1) <= MISFIT;
  if (fits('linear')) return current === 'linear' ? null : 'linear';
  if (ticks.every((k) => k.value > 0) && fits('log10')) return current === 'log10' ? null : 'log10';
  const s = piecewiseScaleFor(ticks);
  return s === current ? null : s;
}

// The scale for a smooth colorbar when the LLM gave none: kept when the
// ticks lie on its line; else linear or log10 when they lie on that line;
// else piecewise when the values step evenly (5, 10, 15) but sit at
// uneven places along the bar, the value per length of bar changing at
// most 2.5 times between neighbouring gaps (t6: 1.2 times). A misread
// label (6 for 5 in 0, 5, 10, 15) breaks the even steps, and the check
// still fails then. Null keeps the panel's scale.
export function scaleForTicks(ticks: TickTV[], current = 'linear') {
  if (ticks.length < 3 || isPiecewiseScale(current)) return null;
  const fits = (scale: string) => (tickMisfit(ticks, scale)?.miss ?? 1) <= MISFIT;
  if (fits(current)) return null;
  if (fits('linear')) return 'linear';
  if (ticks.every((k) => k.value > 0) && fits('log10')) return 'log10';
  const piecewise = piecewiseScaleFor(ticks);
  const v = (k: TickTV) => (isLogScale(piecewise) ? Math.log10(k.value) : k.value);
  const k = [...ticks].sort((a, b) => a.t - b.t);
  const steps = k.slice(1).map((x, i) => v(x) - v(k[i]));
  const mean = steps.reduce((a, d) => a + d, 0) / steps.length;
  if (steps.some((d) => Math.abs(d - mean) > 0.01 * Math.abs(mean))) return null;
  const slopes = k.slice(1).map((x, i) => steps[i] / (x.t - k[i].t));
  if (!slopes.every((s) => Number.isFinite(s) && s && Math.sign(s) === Math.sign(slopes[0]))) return null;
  return slopes.slice(1).every((s, i) => s / slopes[i] <= 2.5 && slopes[i] / s <= 2.5) ? piecewise : null;
}

// The app's own check of a panel. `counts` and `clampedShare` come from
// extractPanel (heatmap/sampling.js), `offMapReasons` counts off-map cells
// by reason, `bins` is the number of colorbar bins (0 for a smooth bar).
// Fails on a problem, ticks off the scale's line, many flagged cells
// (far from the bar's colors) or mostly off-map cells (the wrong
// colorbar). Off-map cells (gray ND cells, a black diagonal) and cells
// past the bar's ends are the figure's design: no placement fixes them.
export function checkSummary({
  problem,
  counts = null,
  clampedShare = 0,
  offMapReasons = {},
  bins = 0,
  misfit = null,
  mark = null,
}: {
  problem?: string | null;
  counts?: Partial<CellCounts> | null;
  clampedShare?: number;
  offMapReasons?: Record<string, number>;
  bins?: number;
  misfit?: { index: number; miss: number } | null;
  mark?: number | string | null;
}) {
  if (problem) return { ok: false, text: `Not ready: ${problem}` };
  const parts: string[] = [];
  const c = { cells: 0, ok: 0, flagged: 0, clamped: 0, offMap: 0, empty: 0, open: 0, ...counts };
  const filled = c.cells - c.empty;
  const badTicks = misfit && misfit.miss > MISFIT;
  if (badTicks) parts.push(`The tick values do not lie on a straight line along the bar; ${mark ? `box ${mark}` : 'one tick'} is ${Math.round(misfit!.miss * 100)}% of the range off. Check that value, or the scale (log10 for constant factors, piecewise for uneven steps).`);
  const many = c.flagged > 0.2 * filled;
  const offMany = c.offMap > 0.3 * filled;
  if (filled) parts.push(`${c.flagged} of ${filled} cells are flagged as far from the colorbar's colors${many ? ' (many: the colorbar or grid may be wrong)' : ''}.`);
  if (c.offMap) {
    const why = Object.entries({ gray: 'gray', hue: 'another hue', far: 'far from every bar color' }).filter(([k]) => offMapReasons[k]).map(([k, w]) => `${offMapReasons[k]} ${w}`).join(', ');
    parts.push(offMany
      ? `${c.offMap} cells have colors that are not on this colorbar (${why}): it is likely not this heatmap's colorbar.`
      : `${c.offMap} cells have colors that are not on the colorbar (${why}), such as gray "ND" cells or a diagonal: they are left empty. Mention it in finish.`);
  }
  if (bins) parts.push(`The colorbar is binned (${bins} bins): each cell gets its bin's middle value${c.open ? `; ${c.open} cells are bounds (at most or at least an outer tick's value)` : ''}.`);
  if (clampedShare > 0.2) parts.push(`${Math.round(clampedShare * 100)}% of the cells are paler or darker than the colorbar's end: their values are only bounds (the end's value). If the colorbar line misses part of the strip (a pale end), fix it with use_colorbar box; otherwise mention it in finish.`);
  else if (c.clamped) parts.push(`${c.clamped} cells are past an end of the colorbar and read as that end (bounds).`);
  const ok = !badTicks && !many && !offMany;
  return { ok, text: `${ok ? 'Check passed.' : 'Check failed.'} ${parts.join(' ')}` };
}

// Numbers printed in cells, read by the LLM, against the values the app
// extracted from the colors (user decision 2026-10-17: the colors stay
// the values; printed numbers are a cross-check). `pairs`: [{row, col
// (1-based), printed, value (null when the cell has none), open?}];
// `range`: {min, max} of the tick values; `scale` as on the colorbar
// (log scales compare in log10). Within 3% of the range is agreement
// (8-bit colors on a 40-unit bar and JPEG noise gave up to 1.2 units, 3%,
// on test-18). Differences that grow with the value (slope of extracted
// on printed off by more than 10%) or one offset for all point at the
// colorbar's ticks or ends, not at single cells. Returns {ok, text}.
const PRINTED_TOL = 0.03;
/** A number printed in a cell against the value extracted (1-based row and col). */
export interface PrintedPair {
  row: number;
  col: number;
  printed: number;
  value: number | null;
  open?: 'below' | 'above' | null;
}
export function printedCheck(pairs: PrintedPair[], range: { min: number; max: number }, scale = 'linear') {
  const log = isLogScale(scale);
  const f = (v: number) => (log ? Math.log10(v) : v);
  const span = Math.abs(f(range.max) - f(range.min)) || 1;
  const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
  const lines: string[] = [];
  const used: { x: number; d: number }[] = [];
  for (const p of pairs) {
    const where = `row ${p.row}, column ${p.col}`;
    if (p.value === null || !Number.isFinite(p.value)) {
      lines.push(`${where}: printed ${fmt(p.printed)}, no value extracted`);
      continue;
    }
    const d = f(p.value) - f(p.printed);
    const bound = p.open ? ` (a bound: the cell is ${p.open === 'below' ? 'below' : 'above'} the bar's end)` : '';
    lines.push(`${where}: printed ${fmt(p.printed)}, extracted ${fmt(p.value)}${bound}, ${Math.round((100 * Math.abs(d)) / span)}% of the range off`);
    if (!p.open && Number.isFinite(f(p.printed))) used.push({ x: f(p.printed), d });
  }
  if (!used.length) return { ok: false, text: `No printed value could be compared. ${lines.join('; ')}.` };
  const off = used.filter((u) => Math.abs(u.d) > PRINTED_TOL * span);
  const parts = [`Printed vs extracted: ${lines.join('; ')}.`];
  // Systematic: one offset for all, or a slope.
  let systematic: string | null = null;
  // (Most of them off: one misread cell is not the colorbar's fault.)
  if (used.length >= 3 && off.length >= Math.max(2, 0.6 * used.length)) {
    const n = used.length;
    const mx = used.reduce((a, u) => a + u.x, 0) / n;
    const my = used.reduce((a, u) => a + u.x + u.d, 0) / n;
    let sxx = 0;
    let sxy = 0;
    for (const u of used) {
      sxx += (u.x - mx) ** 2;
      sxy += (u.x - mx) * (u.x + u.d - my);
    }
    const slope = sxx ? sxy / sxx : 1;
    const bias = used.reduce((a, u) => a + u.d, 0) / n;
    if (sxx && Math.abs(slope - 1) > 0.1) systematic = `the extracted values grow ${slope > 1 ? 'faster' : 'slower'} than the printed ones (slope ${Math.round(slope * 100) / 100})`;
    else if (Math.abs(bias) > PRINTED_TOL * span && used.every((u) => Math.sign(u.d) === Math.sign(bias))) systematic = `the extracted values are all ${bias > 0 ? 'higher' : 'lower'} by about ${fmt(Math.abs(log ? 10 ** bias : bias))}${log ? '×' : ''}`;
  }
  if (systematic) parts.push(`They disagree: ${systematic}. The colorbar's tick values, its ends or its scale are likely wrong: check set_ticks against the printed labels and the bar's ends in the image, fix them, and check again.`);
  else if (off.length) parts.push(`${off.length} of ${used.length} differ by more than ${Math.round(PRINTED_TOL * 100)}% of the range: check those cells' numbers and the grid there (a misread number, or a grid line off its cell).`);
  else parts.push(`They agree within ${Math.round(PRINTED_TOL * 100)}% of the range: the extraction matches the printed numbers.`);
  return { ok: !systematic && !off.length, text: parts.join(' ') };
}

// Rows and columns from fitCellCounts (`fit`, from where the cell borders
// are) and detectGridSize (`det`, from the spacing of color edges; often
// wrong, so a fallback). Per axis: a clean fit (score ≥ 0.7) is taken
// as is. Else a panel on the page with the same extent along the axis
// (`page`, from gridNeighbours) lends its count: t10's gradient strip
// without borders has the 28 columns of the heatmap under it. Else an
// axis about one cell long (a 1 × 8 row of averages under a block, or a
// strip 12 times longer than thick) is one cell. Else a fair fit (≥ 0.45)
// is taken, and the LLM told unless detectGridSize agrees and the next
// best count fits far worse (t2, t3, t6: correct counts were questioned). Below that the detected count stays when it
// is confident (≥ 2), else the cells have no visible borders and the LLM
// counts them from the labels. When a clean fit's cells start or end
// well inside the box (`span` in 0–1), the corners include something
// else (a frame, a white end row the fit left out) and move onto the
// counted cells. `size`: {width, height} of the box. Returns {rows, cols,
// span: {row?, col?}, alt: {row?, col?}, unsure: {row, col} (counts the
// LLM was asked to check, which a later neighbour may settle), notes}.
const CLEAN_FIT = 0.7;
const FAIR_FIT = 0.45;
const SURE_DETECT = 2;
const STRIP = 12;
export function planCounts(
  fit: CountFit,
  det: CountDetection,
  size: { width: number; height: number } | null = null,
  page: Neighbours = {},
): CountPlan {
  const out: CountPlan = { rows: det.rows, cols: det.cols, span: {}, alt: {}, unsure: { row: false, col: false }, notes: [] };
  // The fit's and the detection's fields are read by axis name ("rowScore", "colSize").
  const fnum = (k: string) => (fit as unknown as Record<string, number | undefined>)[k];
  const fstr = (k: string) => (fit as unknown as Record<string, string | undefined>)[k];
  const fspan = (k: string) => (fit as unknown as Record<string, Span | undefined>)[k];
  const dnum = (k: string) => (det as unknown as Record<string, number | undefined>)[k];
  const single = (axis: Axis) => {
    if (!size) return false;
    const other = axis === 'row' ? 'col' : 'row';
    const [len, across] = axis === 'row' ? [size.height, size.width] : [size.width, size.height];
    // A cell's size along this axis: from the other axis' fair fit (cells
    // are about square), a panel lined up with this one, or any panel.
    const ref = [(fnum(`${other}Score`) ?? 0) >= FAIR_FIT ? fnum(`${other}Size`) : null, page[`${axis}Cell`], page.cell].find((v) => v! > 0);
    return (!!ref && len <= 1.6 * ref) || across >= STRIP * len;
  };
  for (const [axis, word] of [['row', 'row'], ['col', 'column']] as const) {
    const key = `${axis}s` as const;
    const count = fnum(key)!;
    const score = fnum(`${axis}Score`) ?? 0;
    const alt = fnum(`${axis}Alt`)!;
    const reason = fstr(`${axis}Reason`) || '';
    const span = fspan(`${axis}Span`);
    const detected = dnum(key);
    const lender = page[axis];
    // A white end cell left out is a tie: the fit with it scores the same
    // (t17 panel i: a first row 6–10 levels from the second). A panel
    // lined up with this one, else detectGridSize, settles it when it
    // counts that cell; the box then stays whole.
    const whiteTie = /white end cell/.test(reason) && alt > count && (fnum(`${axis}AltScore`) ?? 0) >= 0.9 * score && score >= FAIR_FIT;
    const settled = whiteTie && (lender ? lender.count === alt : detected === alt);
    if (settled) {
      out[key] = alt;
      if (lender) out.notes.push(`The ${word} count ${alt} comes from panel ${lender.id}${lender.name ? ` "${lender.name}"` : ''}, whose ${axis === 'col' ? 'x' : 'y'} extent matches (an end ${word} is pale).`);
      continue;
    }
    if (score >= CLEAN_FIT) out[key] = count;
    else if (lender && !(lender.count === 1 && single(axis))) {
      out[key] = lender.count;
      if (score < FAIR_FIT || count !== lender.count) out.notes.push(`The ${word} count ${lender.count} comes from panel ${lender.id}${lender.name ? ` "${lender.name}"` : ''}, whose ${axis === 'col' ? 'x' : 'y'} extent matches (the cells' own ${word} borders are unclear).`);
      continue;
    } else if (single(axis)) {
      out[key] = 1;
      continue;
    } else if (score >= FAIR_FIT) {
      out[key] = count;
      const fitsWell = detected === count && (fnum(`${axis}AltScore`) ?? 0) <= 0.6 * score;
      if (!fitsWell) {
        const others = [...new Set([alt, detected].filter((n) => n && n !== count))];
        out.notes.push(`The app is unsure of the ${word} count: ${count}${others.length ? ` (else ${others.join(' or ')})` : ''}; check it in the image.`);
        out.unsure[axis] = true;
      }
    } else if ((dnum(`${axis}Confidence`) ?? 0) < SURE_DETECT) {
      out.notes.push(`The cells show no clear ${word} borders, so the app could not count the ${word}s (it put ${detected}): count them from the labels or cells and call correct_grid_size, unless a heatmap lined up with it is still to be located (the app then takes its count).`);
      out.unsure[axis] = true;
    }
    const white = /white end cell/.test(reason) && score >= FAIR_FIT;
    if (score >= FAIR_FIT && out[key] === count && span && (span[0] > 0.03 || span[1] < 0.97) && (score >= CLEAN_FIT || white)) {
      out.span[axis] = span;
      if (white) {
        out.alt[axis] = alt;
        const end = span[0] > 0.03 ? 'first' : 'last';
        out.notes.push(`The ${end} ${word} looks white and was left out of the grid: if it is a ${word} of cells, call correct_grid_size with ${key}: ${alt} (the app puts it back).`);
      }
    }
    if (/every other border weak/.test(reason) && out[key] === count && alt) out.notes.push(`Every other ${word} border is faint (a dendrogram or tick marks across the cells?): if the cells are twice as big, use correct_grid_size with ${key}: ${alt}.`);
  }
  return out;
}

// Panels on the page lined up with a box of cells (`panels`: [{id, name,
// cells, rows, cols, unsure?}]): one with the same x extent lends its
// column count and its row height (`col`, `rowCell`), one with the same y
// extent its row count and column width (`row`, `colCell`), within 1.5%
// of the box (at least 4 px). A count that panel was itself unsure of is
// not lent. `cell`: the median cell size of all panels. For planCounts.
export function gridNeighbours(box: Box, panels: PlacedPanel[] = []) {
  const out: Neighbours = {};
  const sizes: number[] = [];
  const tx = Math.max(4, 0.015 * (box.x1 - box.x0));
  const ty = Math.max(4, 0.015 * (box.y1 - box.y0));
  for (const p of panels) {
    const c = p.cells;
    if (!c || !(p.rows > 0 && p.cols > 0)) continue;
    const h = (c.y1 - c.y0) / p.rows;
    const w = (c.x1 - c.x0) / p.cols;
    sizes.push(h, w);
    if (!out.col && !p.unsure?.col && Math.abs(c.x0 - box.x0) <= tx && Math.abs(c.x1 - box.x1) <= tx) {
      out.col = { count: p.cols, id: p.id, name: p.name };
      out.rowCell = h;
    }
    if (!out.row && !p.unsure?.row && Math.abs(c.y0 - box.y0) <= ty && Math.abs(c.y1 - box.y1) <= ty) {
      out.row = { count: p.rows, id: p.id, name: p.name };
      out.colCell = w;
    }
  }
  if (sizes.length) out.cell = sizes.sort((a, b) => a - b)[sizes.length >> 1];
  return out;
}

// The grid for a box of cells: counts (planCounts, with the panels
// already on the page as neighbours) and the box cut to the counted
// cells. Returns planCounts' result plus `cells`.
export function planGrid(img: PixelImage, box: Box, panels: PlacedPanel[] = []) {
  const corners = rectCorners({ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y1 });
  const plan = planCounts(fitCellCounts(img, corners), detectGridSize(img, corners), { width: box.x1 - box.x0, height: box.y1 - box.y0 }, gridNeighbours(box, panels));
  return { ...plan, cells: plan.span.row || plan.span.col ? boxToSpan(box, plan.span) : box };
}

// Earlier panels whose count on an axis was unsure, that line up with a
// panel just placed (`placed`: {id, name, cells, rows, cols, unsure}),
// take its count: t10's gradient strip located before the heatmap under
// it. Returns [{id, rows, cols, note}] for the panels that change.
export function regridOthers(placed: PlacedPanel, panels: PlacedPanel[]) {
  const out: { id: string; rows: number; cols: number; note: string }[] = [];
  for (const p of panels) {
    if (p.id === placed.id || !p.unsure || !(p.unsure.row || p.unsure.col)) continue;
    const n = gridNeighbours(p.cells, [placed]);
    const rows = p.unsure.row && n.row ? n.row.count : p.rows;
    const cols = p.unsure.col && n.col ? n.col.count : p.cols;
    if (rows === p.rows && cols === p.cols) continue;
    const what = [rows !== p.rows && `${rows} rows`, cols !== p.cols && `${cols} columns`].filter(Boolean).join(' and ');
    out.push({ id: p.id, rows, cols, note: `Panel ${p.id}${p.name ? ` "${p.name}"` : ''} now has ${what}, as this heatmap lined up with it.` });
  }
  return out;
}

// A box cut to `span` along each axis (0–1 of its width or height).
export function boxToSpan(box: Box, span: Partial<Record<Axis, Span>>) {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const [c0, c1] = span.col || [0, 1];
  const [r0, r1] = span.row || [0, 1];
  return { x0: box.x0 + c0 * w, y0: box.y0 + r0 * h, x1: box.x0 + c1 * w, y1: box.y0 + r1 * h };
}

// A short view of a panel for tool results: the full snapshot (agent/
// schema.js panelSnapshot) lists every row and column label, 1.2k tokens
// for 60 rows, after every add_tick.
export function panelBrief(p: PanelSnapshot | null | undefined) {
  if (!p) return null;
  const ends = (l: string[] = []) => (l.length > 2 ? `${l[0]} … ${l[l.length - 1]}` : l.join(', '));
  const g = p.grid;
  return {
    id: p.id,
    name: p.name,
    page: p.page,
    ready: p.ready,
    problem: p.problem,
    grid: g ? { rows: g.rows, cols: g.cols, corners: g.corners, labels: `rows ${ends(g.rowLabels)}, columns ${ends(g.colLabels)}` } : null,
    colorbar: { start: p.colorbar.start, end: p.colorbar.end, scale: p.colorbar.scale, ticks: p.colorbar.ticks },
  };
}

export const DECISION_SYSTEM_PROMPT = SYSTEM_PROMPT;
export const decisionQuestions = questions;

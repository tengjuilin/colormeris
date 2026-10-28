// Planning rows and columns of a heatmap from the fit, the detector and neighbouring panels.

import { detectGridSize, fitCellCounts, rectCorners } from '../../core/grid.ts';
import type { Box, PixelImage } from '../../types/index.ts';
import { boxToSpan } from './geometry.ts';
import type { Axis, CountDetection, CountFit, CountPlan, Neighbours, PlacedPanel, Span } from './types.ts';

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
export const FAIR_FIT = 0.45;
const SURE_DETECT = 2;
const STRIP = 12;
export function planCounts(
  fit: CountFit,
  det: CountDetection,
  size: { width: number; height: number } | null = null,
  page: Neighbours = {},
): CountPlan {
  const out: CountPlan = {
    rows: det.rows,
    cols: det.cols,
    span: {},
    alt: {},
    unsure: { row: false, col: false },
    notes: [],
  };
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
    const ref = [
      (fnum(`${other}Score`) ?? 0) >= FAIR_FIT ? fnum(`${other}Size`) : null,
      page[`${axis}Cell`],
      page.cell,
    ].find((v) => v! > 0);
    return (!!ref && len <= 1.6 * ref) || across >= STRIP * len;
  };
  for (const [axis, word] of [
    ['row', 'row'],
    ['col', 'column'],
  ] as const) {
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
    const whiteTie =
      /white end cell/.test(reason) &&
      alt > count &&
      (fnum(`${axis}AltScore`) ?? 0) >= 0.9 * score &&
      score >= FAIR_FIT;
    const settled = whiteTie && (lender ? lender.count === alt : detected === alt);
    if (settled) {
      out[key] = alt;
      if (lender)
        out.notes.push(
          `The ${word} count ${alt} comes from panel ${lender.id}${lender.name ? ` "${lender.name}"` : ''}, whose ${axis === 'col' ? 'x' : 'y'} extent matches (an end ${word} is pale).`,
        );
      continue;
    }
    if (score >= CLEAN_FIT) out[key] = count;
    else if (lender && !(lender.count === 1 && single(axis))) {
      out[key] = lender.count;
      if (score < FAIR_FIT || count !== lender.count)
        out.notes.push(
          `The ${word} count ${lender.count} comes from panel ${lender.id}${lender.name ? ` "${lender.name}"` : ''}, whose ${axis === 'col' ? 'x' : 'y'} extent matches (the cells' own ${word} borders are unclear).`,
        );
      continue;
    } else if (single(axis)) {
      out[key] = 1;
      continue;
    } else if (score >= FAIR_FIT) {
      out[key] = count;
      const fitsWell = detected === count && (fnum(`${axis}AltScore`) ?? 0) <= 0.6 * score;
      if (!fitsWell) {
        const others = [...new Set([alt, detected].filter((n) => n && n !== count))];
        out.notes.push(
          `The app is unsure of the ${word} count: ${count}${others.length ? ` (else ${others.join(' or ')})` : ''}; check it in the image.`,
        );
        out.unsure[axis] = true;
      }
    } else if ((dnum(`${axis}Confidence`) ?? 0) < SURE_DETECT) {
      out.notes.push(
        `The cells show no clear ${word} borders, so the app could not count the ${word}s (it put ${detected}): count them from the labels or cells and call correct_grid_size, unless a heatmap lined up with it is still to be located (the app then takes its count).`,
      );
      out.unsure[axis] = true;
    }
    const white = /white end cell/.test(reason) && score >= FAIR_FIT;
    if (
      score >= FAIR_FIT &&
      out[key] === count &&
      span &&
      (span[0] > 0.03 || span[1] < 0.97) &&
      (score >= CLEAN_FIT || white)
    ) {
      out.span[axis] = span;
      if (white) {
        out.alt[axis] = alt;
        const end = span[0] > 0.03 ? 'first' : 'last';
        out.notes.push(
          `The ${end} ${word} looks white and was left out of the grid: if it is a ${word} of cells, call correct_grid_size with ${key}: ${alt} (the app puts it back).`,
        );
      }
    }
    if (/every other border weak/.test(reason) && out[key] === count && alt)
      out.notes.push(
        `Every other ${word} border is faint (a dendrogram or tick marks across the cells?): if the cells are twice as big, use correct_grid_size with ${key}: ${alt}.`,
      );
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
  const plan = planCounts(
    fitCellCounts(img, corners),
    detectGridSize(img, corners),
    { width: box.x1 - box.x0, height: box.y1 - box.y0 },
    gridNeighbours(box, panels),
  );
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
    const what = [rows !== p.rows && `${rows} rows`, cols !== p.cols && `${cols} columns`]
      .filter(Boolean)
      .join(' and ');
    out.push({
      id: p.id,
      rows,
      cols,
      note: `Panel ${p.id}${p.name ? ` "${p.name}"` : ''} now has ${what}, as this heatmap lined up with it.`,
    });
  }
  return out;
}

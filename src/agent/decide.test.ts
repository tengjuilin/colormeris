import { test } from 'node:test';
import assert from 'node:assert/strict';
import CM from '../load.js';

const { boxToPage, growBox, besideBox, barLine, checkSummary, validateDecisionTool, decisionLlmTools, DECISION_LLM_ACTIONS, decisionQuestions } = CM;

test('boxToPage maps box fractions of a crop back to page pixels', () => {
  // A 400 × 300 page region from (100, 200), drawn at 2× into 800 × 600.
  const b = boxToPage({ left: 0.25, right: 0.75, top: 0.1, bottom: 0.5 }, { x0: 100, y0: 200, scale: 2, width: 800, height: 600 });
  assert.deepEqual(b, { x0: 200, y0: 230, x1: 400, y1: 350 });
});

test('growBox stays on the page', () => {
  assert.deepEqual(growBox({ x0: 10, y0: 10, x1: 110, y1: 60 }, 0.25, 20, 140, 1000), { x0: 0, y0: 0, x1: 140, y1: 92.5 });
});

test('besideBox leaves the cells out', () => {
  const cells = { x0: 100, y0: 100, x1: 300, y1: 200 };
  assert.deepEqual(besideBox(cells, 'right', 1000, 1000), { x0: 301, y0: 75, x1: 420, y1: 225 });
  assert.equal(besideBox(cells, 'below', 1000, 1000).y0, 201);
  assert.equal(besideBox(cells, 'left', 1000, 1000).x1, 99);
});

test('barLine runs along the long axis from the low end', () => {
  assert.deepEqual(barLine({ x0: 10, y0: 20, x1: 30, y1: 220 }), { start: { x: 20, y: 219 }, end: { x: 20, y: 20 } });
  assert.deepEqual(barLine({ x0: 10, y0: 20, x1: 210, y1: 30 }), { start: { x: 10, y: 25 }, end: { x: 209, y: 25 } });
});

test('tickMisfit finds a tick off the line of the others', () => {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t, i) => ({ t, value: 1 + 0.5 * i }));
  assert.ok(CM.tickMisfit(ticks).miss < 1e-9);
  // Reversed values still lie on a line (a reversed bar is valid).
  assert.ok(CM.tickMisfit(ticks.map((k, i) => ({ ...k, value: 3 - 0.5 * i }))).miss < 1e-9);
  const bad = ticks.map((k, i) => (i === 3 ? { ...k, value: 25 } : k));
  assert.equal(CM.tickMisfit(bad).index, 3);
  const log = [0, 0.5, 1].map((t, i) => ({ t, value: 10 ** i }));
  assert.ok(CM.tickMisfit(log, 'log10').miss < 1e-9);
  assert.equal(CM.tickMisfit(ticks.slice(0, 2)), null);
});

const counts = (o) => ({ cells: 100, ok: 100, flagged: 0, clamped: 0, offMap: 0, empty: 0, open: 0, ...o });

test('checkSummary fails on bad ticks, many flags or a problem', () => {
  assert.ok(checkSummary({ counts: counts({ flagged: 1 }), misfit: { index: 0, miss: 0.01 } }).ok);
  assert.ok(!checkSummary({ counts: counts(), misfit: { index: 2, miss: 0.2 }, mark: 3 }).ok);
  assert.match(checkSummary({ counts: counts(), misfit: { index: 2, miss: 0.2 }, mark: 3 }).text, /box 3/);
  assert.ok(!checkSummary({ counts: counts({ flagged: 30 }) }).ok);
  assert.ok(!checkSummary({ problem: 'Add at least two ticks.' }).ok);
});

test('checkSummary: off-map cells and bins are expected, mostly off-map is not', () => {
  // A black diagonal (27 of 729 cells) is left empty, and says so.
  const diag = checkSummary({ counts: counts({ cells: 729, offMap: 27 }), offMapReasons: { gray: 27 } });
  assert.ok(diag.ok);
  assert.match(diag.text, /27 gray/);
  assert.match(diag.text, /left empty/);
  assert.doesNotMatch(diag.text, /past an end/);
  assert.ok(!checkSummary({ counts: counts({ offMap: 60 }), offMapReasons: { hue: 60 } }).ok);
  const binned = checkSummary({ counts: counts({ open: 12 }), bins: 7 });
  assert.ok(binned.ok);
  assert.match(binned.text, /binned \(7 bins\).*12 cells are bounds/);
});

test('cells past an end of the colorbar do not fail the check, but a big share warns', () => {
  const s = checkSummary({ counts: counts({ cells: 384, clamped: 318 }), clampedShare: 318 / 384 });
  assert.equal(s.ok, true);
  assert.match(s.text, /83% of the cells are paler or darker/);
  assert.match(checkSummary({ counts: counts({ clamped: 5 }), clampedShare: 0.05 }).text, /5 cells are past an end/);
});

test('tickMisfit follows the scale: log10 for log scales, none for piecewise', () => {
  const uneven = [1e4, 2e4, 2e5, 5e5, 1e6, 3e6].map((value, i) => ({ t: i / 5, value }));
  assert.ok(CM.tickMisfit(uneven, 'log10').miss > 0.03);
  assert.equal(CM.tickMisfit(uneven, 'piecewise-log10'), null);
  assert.equal(CM.tickMisfit(uneven, 'piecewise'), null);
  const log = [0, 0.5, 1].map((t, i) => ({ t, value: 10 ** i }));
  assert.ok(CM.tickMisfit(log, 'piecewise-log10') === null && CM.tickMisfit(log, 'log10').miss < 1e-9);
});

test('scaleForBins keeps a fitting line and picks piecewise for uneven ticks', () => {
  const even = [0, 3, 6, 9, 12].map((value, i) => ({ t: i / 4, value }));
  assert.equal(CM.scaleForBins(even, 'linear'), null);
  const uneven = [1e4, 2e4, 2e5, 5e5, 1e6, 3e6].map((value, i) => ({ t: i / 5, value }));
  assert.equal(CM.scaleForBins(uneven, 'linear'), 'piecewise-log10');
  assert.equal(CM.scaleForBins(uneven, 'piecewise-log10'), null);
  const decades = [1, 10, 100].map((value, i) => ({ t: i / 2, value }));
  assert.equal(CM.scaleForBins(decades, 'linear'), 'log10');
  assert.equal(CM.scaleForBins(even.slice(0, 2), 'linear'), null);
});

test('decision tools validate their arguments', () => {
  assert.deepEqual(validateDecisionTool('set_ticks', { ticks: [{ mark: 1, value: 3 }, { mark: 2, value: 1 }] }), []);
  assert.ok(validateDecisionTool('set_ticks', { ticks: [{ mark: 1, value: 3 }] }).length);
  assert.ok(validateDecisionTool('locate_heatmap', { name: 'Fig 1a' }).length);
  assert.deepEqual(validateDecisionTool('ask', { questions: { q: { type: 'noul', instructions: 'Is it blue?' } } }), []);
  assert.ok(validateDecisionTool('ask', { questions: { q: { type: 'score', instructions: 'How?', criteria: { a: 1 } } } }).length);
  assert.ok(validateDecisionTool('ask', { questions: {} }).length);
});

test('the LLM can only correct the app\'s rows and columns, with a reason', () => {
  const names = decisionLlmTools().map((t) => t.function.name);
  assert.ok(!names.includes('set_grid_size') && !names.includes('detect_grid_size'));
  assert.ok(names.includes('correct_grid_size'));
  assert.ok(validateDecisionTool('correct_grid_size', { rows: 32, cols: 9 }).length);
  assert.deepEqual(validateDecisionTool('correct_grid_size', { rows: 32, cols: 9, reason: '3 replicate cells per label' }), []);
  assert.ok(names.includes('locate_heatmap') && names.includes('finish'));
  assert.ok(!DECISION_LLM_ACTIONS.includes('set_grid_size'));
});

test('decision questions are about one heatmap each', () => {
  const q = decisionQuestions.find('panel f, "Oxidative stress"');
  assert.deepEqual(Object.keys(q), ['present', 'cells']);
  assert.match(q.cells.instructions, /Oxidative stress/);
  assert.equal(decisionQuestions.side().side.type, 'choice');
});

test('besideCheck keeps a colorbar next to the cells and drops a neighbour\'s', () => {
  const g = { x0: 759, y0: 794, x1: 1046, y1: 962 };
  assert.ok(CM.besideCheck(g, { x0: 1067, y0: 793, x1: 1094, y1: 963 }, 'right'));
  // Panel f's colorbar, 159 px to the left of panel g.
  assert.ok(!CM.besideCheck(g, { x0: 578, y0: 793, x1: 600, y1: 972 }, 'left'));
  // Panel h's colorbar 72 px left of panel i, its labels facing i.
  const i = { x0: 952, y0: 965, x1: 1171, y1: 1294 };
  assert.ok(!CM.besideCheck(i, { x0: 866, y0: 964, x1: 880, y1: 1286 }, 'left', 'right'));
  assert.ok(CM.besideCheck(i, { x0: 1182, y0: 965, x1: 1196, y1: 1290 }, 'right', 'right'));
  // A 3 px sliver is not a colorbar.
  assert.ok(!CM.besideCheck(i, { x0: 887, y0: 937, x1: 890, y1: 1292 }, 'left'));
  // A strip beside only the top of the cells.
  assert.ok(!CM.besideCheck(g, { x0: 1067, y0: 600, x1: 1094, y1: 820 }, 'right'));
});

test('locate_heatmap takes the LLM\'s rough box after a miss', () => {
  assert.deepEqual(validateDecisionTool('locate_heatmap', { name: 'c', description: 'panel c', panelId: 'p2', box: { x0: 350, y0: 190, x1: 1830, y1: 730 } }), []);
  assert.ok(validateDecisionTool('locate_heatmap', { name: 'c', description: 'panel c', box: { x0: 350 } }).length);
});

test('set_ticks takes a box number or a place along the strip, not both', () => {
  assert.deepEqual(validateDecisionTool('set_ticks', { ticks: [{ t: 0, value: 15 }, { mark: 2, value: 5 }] }), []);
  assert.ok(validateDecisionTool('set_ticks', { ticks: [{ t: 0, mark: 1, value: 15 }, { mark: 2, value: 5 }] }).length);
  assert.ok(validateDecisionTool('set_ticks', { ticks: [{ value: 15 }, { mark: 2, value: 5 }] }).length);
  // A model's null for the other one means "not given".
  const args = CM.cleanDecisionArgs('set_ticks', { panelId: null, ticks: [{ mark: 1, t: null, value: 1 }, { mark: null, t: 1, value: 2 }] });
  assert.deepEqual(args, { ticks: [{ mark: 1, value: 1 }, { t: 1, value: 2 }] });
  assert.deepEqual(validateDecisionTool('set_ticks', args), []);
  assert.deepEqual(validateDecisionTool('set_ticks', { ticks: [{ t: 0, value: 1 }, { t: 1, value: 2 }], scale: 'piecewise-log10' }), []);
});

test('tFromTopLeft measures from the top or left end whichever way the line runs', () => {
  const up = { start: { x: 5, y: 100 }, end: { x: 5, y: 0 } };
  assert.equal(CM.tFromTopLeft(up.start, up.end, 0.2), 0.8);
  assert.equal(CM.tFromTopLeft(up.end, up.start, 0.2), 0.2);
  assert.equal(CM.tFromTopLeft({ x: 0, y: 3 }, { x: 100, y: 3 }, 0.2), 0.2);
});

test('use_colorbar takes exactly one source', () => {
  assert.deepEqual(validateDecisionTool('use_colorbar', { candidate: 'B' }), []);
  assert.deepEqual(validateDecisionTool('use_colorbar', { panelId: 'p2', fromPanel: 'p1' }), []);
  assert.deepEqual(validateDecisionTool('use_colorbar', { box: { x0: 1, y0: 2, x1: 30, y1: 300 } }), []);
  assert.ok(validateDecisionTool('use_colorbar', {}).length);
  assert.ok(validateDecisionTool('use_colorbar', { candidate: 'A', fromPanel: 'p1' }).length);
  assert.ok(decisionLlmTools().some((t) => t.function.name === 'use_colorbar'));
});

test('chooseColorbar: one beside wins, several or a far one go to the LLM', () => {
  const cells = { x0: 135, y0: 262, x1: 1317, y1: 768 };
  const own = { bar: { x0: 1582, y0: 271, x1: 1634, y1: 502 }, labelSide: 'right', labels: 5 };
  // test-10: the block above's colorbar also sits right of the main heatmap.
  const other = { bar: { x0: 1386, y0: 355, x1: 1438, y1: 685 }, labelSide: 'right', labels: 7 };
  const two = CM.chooseColorbar(cells, [own, other]);
  assert.deepEqual(two.list.map((c) => [c.letter, c.gap]), [['A', 69], ['B', 265]]);
  assert.equal(CM.chooseColorbar(cells, [own]).how, 'beside');
  // A strip far below a thin strip of cells: the LLM chooses.
  const strip = { x0: 135, y0: 52, x1: 1317, y1: 93 };
  const far = { bar: { x0: 1584, y0: 598, x1: 1633, y1: 801 }, labelSide: 'right', labels: 5 };
  assert.equal(CM.chooseColorbar(strip, [own, other, far]).list.length, 3);
  // test-6: a narrow tall heatmap, its colorbar 140 px away (beyond besideCheck's reach).
  const d = { x0: 176, y0: 161, x1: 356, y1: 988 };
  const bar6 = { bar: { x0: 496, y0: 174, x1: 523, y1: 526 }, labelSide: 'right', labels: 3 };
  assert.equal(CM.chooseColorbar(d, [bar6]).how, 'near');
  // test-14: tick labels facing the cells.
  const c14 = { x0: 223, y0: 22, x1: 891, y1: 595 };
  assert.equal(CM.chooseColorbar(c14, [{ bar: { x0: 1028, y0: 143, x1: 1073, y1: 626 }, labelSide: 'left', labels: 3 }]).how, 'near');
  // test-1: one colorbar for blocks far from it.
  const ctrl = { x0: 299, y0: 101, x1: 394, y1: 421 };
  assert.equal(CM.chooseColorbar(ctrl, [{ bar: { x0: 3020, y0: 97, x1: 3060, y1: 438 }, labelSide: 'right', labels: 4 }]).how, 'only');
  assert.deepEqual(CM.chooseColorbar(ctrl, []), { list: [] });
});

test('planCounts follows the fit by its score and tells the LLM when unsure', () => {
  const det = { rows: 1, cols: 2, rowConfidence: 1.2, colConfidence: 1.4 };
  const clean = CM.planCounts({ rows: 12, cols: 28, rowScore: 0.89, colScore: 0.81, rowSpan: [0.005, 0.99], colSpan: [0, 1] }, det);
  assert.deepEqual([clean.rows, clean.cols, clean.notes, clean.span], [12, 28, [], {}]);
  // test-10's D block: fair fits are taken, with a note.
  const fair = CM.planCounts({ rows: 3, cols: 28, rowScore: 0.63, colScore: 0.56, colAlt: 12, rowSpan: [0, 1], colSpan: [0, 1] }, det);
  assert.deepEqual([fair.rows, fair.cols], [3, 28]);
  assert.match(fair.notes.join(' '), /unsure of the column count: 28 \(else 12 or 2\)/);
  // test-10's -log10(p) strip: no borders, detection unsure → the LLM counts.
  const none = CM.planCounts({ rows: 15, cols: 1, rowScore: 0, colScore: 0.24, rowReason: 'weak fit; 1 white end cell left out', colReason: 'weak borders', rowSpan: [0, 0.96], colSpan: [0, 1] }, det);
  assert.deepEqual([none.rows, none.cols, none.span], [1, 2, {}]);
  assert.match(none.notes.join(' '), /no clear row borders.*no clear column borders/);
  // A confident detection stays.
  assert.deepEqual(CM.planCounts({ rows: 10, cols: 5, rowScore: 0.2, colScore: 0.9 }, { rows: 5, cols: 5, rowConfidence: 2.9 }).notes, []);
  // A clean fit inside the box moves the corners; a white end row can come back.
  const white = CM.planCounts({ rows: 9, cols: 10, rowScore: 0.9, colScore: 0.9, rowAlt: 10, rowReason: 'clean; 1 white end cell left out', rowSpan: [0, 0.9], colSpan: [0.05, 1] }, det);
  assert.deepEqual(white.span, { row: [0, 0.9], col: [0.05, 1] });
  assert.equal(white.alt.row, 10);
  assert.match(white.notes.join(' '), /last row looks white.*rows: 10/);
  assert.deepEqual(CM.boxToSpan({ x0: 0, y0: 0, x1: 100, y1: 200 }, white.span), { x0: 5, y0: 0, x1: 100, y1: 180 });
  assert.match(CM.planCounts({ rows: 42, cols: 3, rowScore: 0.79, colScore: 0.9, rowAlt: 21, rowReason: 'every other border weak' }, det).notes.join(' '), /rows: 21/);
});

test('panelBrief keeps a tool result short', () => {
  const p = { id: 'p1', name: 'f', page: 1, ready: false, problem: 'x', grid: { rows: 60, cols: 2, corners: [], rowLabels: Array.from({ length: 60 }, (_, i) => `R${i + 1}`), colLabels: ['a', 'b'] }, colorbar: { start: null, end: null, scale: 'linear', ticks: [] } };
  const b = CM.panelBrief(p);
  assert.equal(b.grid.labels, 'rows R1 … R60, columns a, b');
  assert.ok(JSON.stringify(b).length < 400);
});

test('flankInk tells a colorbar on the page from a run of cells in a heatmap', () => {
  const W = 200;
  const H = 120;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const paint = (x0, y0, x1, y1, rgb) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([...rgb, 255], (y * W + x) * 4);
  };
  paint(10, 10, 100, 100, [200, 40, 40]); // a heatmap block
  paint(40, 50, 70, 60, [40, 40, 200]); // a run of cells inside it
  paint(150, 10, 165, 100, [40, 160, 40]); // a colorbar on the page
  const img = { width: W, height: H, data };
  assert.equal(CM.flankInk(img, { x0: 150, y0: 10, x1: 165, y1: 100 }, [], true), 0);
  assert.ok(CM.flankInk(img, { x0: 40, y0: 50, x1: 70, y1: 60 }, [], true) > 0.9);
  // Known cells are skipped.
  assert.equal(CM.flankInk(img, { x0: 40, y0: 50, x1: 70, y1: 60 }, [{ x0: 10, y0: 10, x1: 100, y1: 100 }], true), 0);
});

test('planCounts counts an axis about one cell long as one cell', () => {
  // test-1: a 1 × 8 row of averages, 108 px tall with 105 px wide cells.
  const fit = { rows: 0, cols: 8, rowScore: 0, colScore: 0.6, colSize: 105, rowSpan: [0, 1], colSpan: [0, 1] };
  const plan = CM.planCounts(fit, { rows: 2, cols: 8, rowConfidence: 1, colConfidence: 1 }, { width: 841, height: 108 });
  assert.equal(plan.rows, 1);
  assert.doesNotMatch(plan.notes.join(' '), /row borders/);
  assert.match(CM.planCounts(fit, { rows: 2, cols: 8, rowConfidence: 1 }, { width: 841, height: 400 }).notes.join(' '), /no clear row borders/);
});

test('chooseColorbar never takes a group strip along the cells, and ranks strips with numbers first', () => {
  // test-9: the "Group" strip right above the cells, exactly as wide, no
  // tick labels; the real colorbar 178 px to the right with 3 labels.
  const cells = { x0: 303, y0: 194, x1: 1968, y1: 1534 };
  const group = { bar: { x0: 301, y0: 151, x1: 1968, y1: 187 }, labelSide: 'above', labels: 0 };
  const real = { bar: { x0: 2146, y0: 144, x1: 2193, y1: 345 }, labelSide: 'right', labels: 3 };
  assert.deepEqual(CM.chooseColorbar(cells, [group, real]), { bar: real.bar, how: 'beside' });
  // A strip without labels right beside the cells is not taken over a
  // numbered one further away; the list puts the numbered one first.
  // (test-1: the decision model boxed the Average row left of another one.)
  const avg = { x0: 1260, y0: 434, x1: 1668, y1: 538 };
  const row = { bar: { x0: 407, y0: 433, x1: 1244, y1: 538 }, labelSide: 'below', labels: 0 };
  const far = { bar: { x0: 3020, y0: 97, x1: 3060, y1: 438 }, labelSide: 'right', labels: 4 };
  assert.deepEqual(CM.chooseColorbar(avg, [row, far]), { bar: far.bar, how: 'only' });
  const short = { bar: { x0: 1680, y0: 440, x1: 1700, y1: 530 }, labelSide: 'right', labels: 0 };
  const pick = CM.chooseColorbar(avg, [short, far]);
  assert.deepEqual(pick.list.map((c) => [c.letter, c.labels]), [['A', 4], ['B', 0]]);
  // Alone, an unlabelled strip is still taken (a gray colormap's labels may be missed).
  assert.equal(CM.chooseColorbar(cells, [{ ...real, labels: 0 }]).how, 'beside');
});

test('planCounts takes a count from a panel lined up with the cells', () => {
  // test-10: the -log10(p) strip (1182 × 41 px) has no borders; the heatmap
  // under it spans the same x and has 28 columns of 42 px.
  const strip = { x0: 135, y0: 52, x1: 1317, y1: 93 };
  const main = { id: 'p8', name: 'main', cells: { x0: 135, y0: 262, x1: 1317, y1: 768 }, rows: 12, cols: 28 };
  const fit = { rows: 15, cols: 3, rowScore: 0, colScore: 0.14, rowSpan: [0, 1], colSpan: [0, 1] };
  const det = { rows: 1, cols: 1, rowConfidence: 0, colConfidence: 0 };
  const size = { width: 1182, height: 41 };
  const page = CM.gridNeighbours(strip, [main]);
  assert.deepEqual([page.col.count, Math.round(page.rowCell)], [28, 42]);
  const plan = CM.planCounts(fit, det, size, page);
  assert.deepEqual([plan.rows, plan.cols, plan.unsure], [1, 28, { row: false, col: false }]);
  assert.match(plan.notes.join(' '), /column count 28 comes from panel p8 "main", whose x extent matches/);
  // Alone, a strip 12 times longer than thick is one row; columns are the LLM's.
  const alone = CM.planCounts(fit, det, size);
  assert.deepEqual([alone.rows, alone.unsure], [1, { row: false, col: true }]);
  // A panel unsure of its own count lends nothing; a clean fit needs no lender.
  assert.equal(CM.gridNeighbours(strip, [{ ...main, unsure: { row: false, col: true } }]).col, undefined);
  assert.equal(CM.planCounts({ ...fit, cols: 27, colScore: 0.9 }, det, size, page).cols, 27);
});

test('planCounts: a fair fit that detection agrees with needs no check', () => {
  // test-2: 5 × 5 at 0.50 / 0.62, the next best counts far worse, detection 5 × 5.
  const fit = { rows: 5, cols: 5, rowScore: 0.5, colScore: 0.62, rowAlt: 2, colAlt: 10, rowAltScore: 0.18, colAltScore: 0.27, rowSpan: [0, 1], colSpan: [0, 1] };
  const plan = CM.planCounts(fit, { rows: 5, cols: 5, rowConfidence: 1.9, colConfidence: 1.9 });
  assert.deepEqual(plan.notes, []);
  assert.match(CM.planCounts(fit, { rows: 2, cols: 5, rowConfidence: 1.9, colConfidence: 1.9 }).notes.join(' '), /unsure of the row count: 5 \(else 2\)/);
});

test('regridOthers settles an earlier panel\'s unsure count from one lined up with it', () => {
  const strip = { id: 'p6', name: 'p', cells: { x0: 135, y0: 52, x1: 1317, y1: 93 }, rows: 1, cols: 1, unsure: { row: false, col: true } };
  const block = { id: 'p7', name: 'D', cells: { x0: 135, y0: 113, x1: 1317, y1: 240 }, rows: 3, cols: 28, unsure: { row: false, col: true } };
  const main = { id: 'p8', name: 'main', cells: { x0: 136, y0: 262, x1: 1316, y1: 768 }, rows: 12, cols: 28, unsure: { row: false, col: false } };
  assert.deepEqual(CM.regridOthers(main, [strip, block]), [{ id: 'p6', rows: 1, cols: 28, note: 'Panel p6 "p" now has 28 columns, as this heatmap lined up with it.' }]);
  assert.deepEqual(CM.regridOthers({ ...main, unsure: { row: false, col: true } }, [strip]), []);
});

test('scaleForTicks picks piecewise for evenly stepped labels at uneven places', () => {
  // test-6: 5, 10, 15 at t 0.204, 0.493, 0.846 on a smooth bar.
  const t6 = [{ t: 0.204, value: 5 }, { t: 0.493, value: 10 }, { t: 0.846, value: 15 }];
  assert.equal(CM.scaleForTicks(t6), 'piecewise');
  assert.equal(CM.scaleForTicks(t6, 'piecewise'), null);
  // On a line: nothing to change; constant factors: log10.
  assert.equal(CM.scaleForTicks([{ t: 0, value: 0 }, { t: 0.5, value: 5 }, { t: 1, value: 10 }]), null);
  assert.equal(CM.scaleForTicks([{ t: 0, value: 1 }, { t: 0.5, value: 10 }, { t: 1, value: 100 }]), 'log10');
  // A misread label (6 for 5) breaks the even steps: the check must fail.
  assert.equal(CM.scaleForTicks([{ t: 0, value: 0 }, { t: 1 / 3, value: 6 }, { t: 2 / 3, value: 10 }, { t: 1, value: 15 }]), null);
});

test('tickBoxesText says how many boxes there are and which look odd', () => {
  const marks = [{}, { note: 'larger than the other labels (a title, or two labels joined?)' }, {}];
  const text = CM.tickBoxesText(marks, { extended: true });
  assert.match(text, /3 tick-label boxes found, numbered 1–3.*no others.*\{t, value\}/);
  assert.match(text, /box 2 is larger/);
  assert.match(text, /extended/);
  assert.match(CM.tickBoxesText([]), /No tick labels/);
});

test('planCounts settles a white end cell left out by a neighbour or detectGridSize', () => {
  // Test-17 panel i: the pale first row was left out (4 rows, alt 5 at the
  // same score); the panels beside it and detectGridSize have 5.
  const fit = { rows: 4, cols: 15, rowScore: 0.8, colScore: 0.82, rowAlt: 5, rowAltScore: 0.8, rowReason: 'clean; 1 white end cell left out', rowSpan: [0.19, 0.98], colSpan: [0, 1], rowSize: 46, colSize: 45 };
  const size = { width: 678, height: 230 };
  const lent = CM.planCounts(fit, { rows: 5, cols: 15 }, size, { row: { count: 5, id: 'p3', name: 'e' } });
  assert.deepEqual([lent.rows, lent.span.row], [5, undefined]);
  const detected = CM.planCounts(fit, { rows: 5, cols: 15 }, size);
  assert.deepEqual([detected.rows, detected.span.row], [5, undefined]);
  // Neither counts the white row: it stays out, and the LLM is told.
  const cut = CM.planCounts(fit, { rows: 4, cols: 15 }, size);
  assert.deepEqual([cut.rows, cut.span.row], [4, [0.19, 0.98]]);
  assert.ok(cut.notes.some((n) => /looks white/.test(n)));
});

test('chooseColorbar leaves out a strip labelled with the cells\' own column labels', () => {
  // Test-16: a dashed outline under the cells, its "tick labels" the 13
  // rotated column labels; the real bar is on the right.
  const cells = { x0: 119, y0: 116, x1: 1144, y1: 502 };
  const pitch = (1144 - 119) / 13;
  const outline = { bar: { x0: 104, y0: 508, x1: 1155, y1: 514 }, labelSide: 'below', labels: 13, labelsAt: Array.from({ length: 13 }, (_, i) => ({ x: 119 + (i + 0.5) * pitch + 3, y: 511 })) };
  const bar = { bar: { x0: 1174, y0: 116, x1: 1216, y1: 501 }, labelSide: 'right', labels: 3, labelsAt: [{ x: 1195, y: 116 }, { x: 1195, y: 302 }, { x: 1195, y: 500 }] };
  assert.equal(CM.chooseColorbar(cells, [outline, bar]).bar, undefined);
  assert.deepEqual(CM.chooseColorbar(cells, [outline, bar], { rows: 5, cols: 13 }), { bar: bar.bar, how: 'beside' });
});

test('printedCheck agrees within 3% and names a systematic disagreement', () => {
  const range = { min: 60, max: 100 };
  const near = CM.printedCheck([{ row: 1, col: 1, printed: 62.2, value: 61.4 }, { row: 1, col: 3, printed: 90.6, value: 90.9 }, { row: 3, col: 4, printed: 91.4, value: 91.6 }], range);
  assert.ok(near.ok && /agree/.test(near.text), near.text);
  // Ticks read as 60–100 for a bar of 50–100: the values grow too slowly.
  const slope = CM.printedCheck([62, 75, 88, 99].map((v, i) => ({ row: 1, col: i + 1, printed: v, value: 60 + ((v - 50) / 50) * 40 })), range);
  assert.ok(!slope.ok && /slope/.test(slope.text), slope.text);
  const shifted = CM.printedCheck([62, 75, 88].map((v, i) => ({ row: 2, col: i + 1, printed: v, value: v + 4 })), range);
  assert.ok(!shifted.ok && /all higher/.test(shifted.text), shifted.text);
  const one = CM.printedCheck([{ row: 1, col: 1, printed: 70, value: 70.2 }, { row: 1, col: 2, printed: 80, value: 86 }, { row: 1, col: 3, printed: 90, value: 90.1 }], range);
  assert.ok(!one.ok && /1 of 3 differ/.test(one.text), one.text);
  const bound = CM.printedCheck([{ row: 1, col: 1, printed: 55, value: 60, open: 'below' }, { row: 1, col: 2, printed: 80, value: 80 }], range);
  assert.ok(bound.ok && /a bound/.test(bound.text), bound.text);
});

test('validateDecisionTool checks check_printed cells', () => {
  assert.deepEqual(validateDecisionTool('check_printed', { cells: [{ row: 1, col: 2, value: 3.5 }] }), []);
  assert.ok(validateDecisionTool('check_printed', { cells: [] }).length);
  assert.ok(validateDecisionTool('check_printed', { cells: [{ row: 0, col: 2, value: 3 }] }).length);
});

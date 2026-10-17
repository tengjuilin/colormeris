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

test('checkSummary fails on bad ticks, many flags or a problem', () => {
  assert.ok(checkSummary({ flagged: 1, cells: 100, misfit: { index: 0, miss: 0.01 } }).ok);
  assert.ok(!checkSummary({ flagged: 0, cells: 100, misfit: { index: 2, miss: 0.2 }, mark: 3 }).ok);
  assert.match(checkSummary({ flagged: 0, cells: 100, misfit: { index: 2, miss: 0.2 }, mark: 3 }).text, /box 3/);
  assert.ok(!checkSummary({ flagged: 30, cells: 100 }).ok);
  assert.ok(!checkSummary({ problem: 'Add at least two ticks.' }).ok);
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

test('cells past an end of the colorbar do not fail the check', () => {
  assert.equal(checkSummary({ flagged: 318, cells: 384, beyond: 300 }).ok, true);
  assert.match(checkSummary({ flagged: 318, cells: 384, beyond: 300 }).text, /past an end of the colorbar/);
  assert.equal(checkSummary({ flagged: 318, cells: 384 }).ok, false);
});

test('locate_heatmap takes the LLM\'s rough box after a miss', () => {
  assert.deepEqual(validateDecisionTool('locate_heatmap', { name: 'c', description: 'panel c', panelId: 'p2', box: { x0: 350, y0: 190, x1: 1830, y1: 730 } }), []);
  assert.ok(validateDecisionTool('locate_heatmap', { name: 'c', description: 'panel c', box: { x0: 350 } }).length);
});

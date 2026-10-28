import { test } from 'node:test';
import assert from 'node:assert/strict';
import CM from '../load.js';

const { labelsTool, parseLabelsAnswer, labelsUserText } = CM;
const msg = (args) => ({ toolCalls: [{ function: { name: 'set_labels', arguments: typeof args === 'string' ? args : JSON.stringify(args) } }] });

test('labelsTool requires both label lists', () => {
  const t = labelsTool();
  assert.equal(t.function.name, 'set_labels');
  assert.deepEqual(t.function.parameters.required, ['rowLabels', 'colLabels']);
});

test('parseLabelsAnswer trims, drops empties and has no warnings when counts match', () => {
  const r = parseLabelsAnswer(msg({ rowLabels: [' A ', 'B', ''], colLabels: ['1', '2', '3'] }), { rows: 2, cols: 3 });
  assert.deepEqual(r.rowLabels, ['A', 'B']);
  assert.deepEqual(r.colLabels, ['1', '2', '3']);
  assert.deepEqual(r.warnings, []);
});

test('parseLabelsAnswer warns on count mismatch and missing sides', () => {
  const r = parseLabelsAnswer(msg({ rowLabels: ['A'], colLabels: [], note: 'cut off' }), { rows: 2, cols: 3 });
  assert.deepEqual(r.warnings, ['1 row labels for 2 rows', 'no column labels']);
  assert.equal(r.note, 'cut off');
});

test('parseLabelsAnswer throws without a tool call or with bad JSON', () => {
  assert.throws(() => parseLabelsAnswer({ content: 'hi' }), /did not return/);
  assert.throws(() => parseLabelsAnswer(msg('{oops')), /not valid JSON/);
});

test('labelsUserText states counts and the grid box', () => {
  const s = labelsUserText({ rows: 9, cols: 12, box: { x0: 10.4, x1: 200, y0: 5, y1: 90 } });
  assert.match(s, /9 rows and 12 columns/);
  assert.match(s, /x 10–200, y 5–90/);
});

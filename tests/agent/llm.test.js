import { test } from 'node:test';
import assert from 'node:assert/strict';
import CM from '../load.js';

const { pruneImages, parsePages, llmTools, validateRunnerTool, toolResultText } = CM;

test('pruneImages keeps the newest images and moves its cut in steps', () => {
  const img = (n) => ({ role: 'user', content: [{ type: 'text', text: `i${n}` }, { type: 'image_url', imageUrl: { url: `data:${n}` } }] });
  const msgs = [{ role: 'system', content: 'x' }, img(1), { role: 'tool', toolCallId: 'a', content: '{}' }, img(2), img(3)];
  const out = pruneImages(msgs, 2, 1);
  assert.equal(out[1].content[1].type, 'text');
  assert.equal(out[3].content[1].type, 'image_url');
  assert.equal(out[4].content[1].type, 'image_url');
  assert.equal(msgs[1].content[1].type, 'image_url', 'input is not modified');

  // Cache stability: between two cuts the same old messages are rewritten, so
  // the request prefix does not change from step to step.
  const many = Array.from({ length: 12 }, (_, i) => img(i));
  const kept = (n) => pruneImages(many.slice(0, n), 3, 4).filter((m) => m.content[1].type === 'image_url').length;
  assert.deepEqual([3, 4, 6, 7, 8, 11, 12].map(kept), [3, 4, 6, 3, 4, 3, 4]);
  const a = pruneImages(many.slice(0, 8), 3, 4);
  const b = pruneImages(many.slice(0, 9), 3, 4);
  assert.deepEqual(a, b.slice(0, 8), 'one more image leaves the earlier messages as they were');
});

test('parsePages reads ranges and clamps to the page count', () => {
  assert.deepEqual(parsePages('2-4, 7', 10), [2, 3, 4, 7]);
  assert.deepEqual(parsePages('9-12', 10), [9, 10]);
  assert.throws(() => parsePages('a', 10), /Cannot read/);
});

test('LLM tools have unique names; runner tool arguments are checked', () => {
  const names = llmTools().map((t) => t.function.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('view_page') && names.includes('set_grid') && !names.includes('answer_question') && !names.includes('decide'));
  assert.deepEqual(validateRunnerTool('view_pages_overview', { from: 1, to: 3 }), []);
  assert.ok(validateRunnerTool('view_pages_overview', { from: 1 }).length);
  assert.match(toolResultText('x'.repeat(20), 5), /cut 15 characters/);
});

test('retry guard: counts attempts, blocks after the limit, stops long failure runs', () => {
  const g = CM.createRetryGuard({ maxAttempts: 2, maxErrorsInARow: 3 });
  const bad = { ok: false, error: 'args: bad.' };
  assert.equal(g.before('add_tick', 'p1'), null);
  assert.match(g.after('add_tick', 'p1', bad).error, /Attempt 1 of 2/);
  assert.match(g.after('add_tick', 'p1', bad).error, /now blocked/);
  assert.match(g.before('add_tick', 'p1').error, /blocked for this panel/);
  assert.equal(g.before('add_tick', 'p2'), null, 'other panels are not blocked');
  assert.equal(g.after('set_grid', 'p1', { ok: true }).ok, true);
  assert.equal(g.stop, null);
  g.after('a', 'p1', bad);
  g.after('b', 'p1', bad);
  g.after('c', 'p1', bad);
  assert.match(g.stop, /3 tool calls in a row failed/);
});

test('normalizeArgs forgives nulls and at+t on add_tick', () => {
  const r = CM.normalizeArgs('add_tick', { at: { x: 1, y: 2 }, t: 0.5, value: 3, panelId: null });
  assert.deepEqual(r.args, { at: { x: 1, y: 2 }, value: 3 });
  assert.match(r.notes[0], /used at/);
  assert.deepEqual(CM.validateAction('add_tick', r.args), []);
  assert.match(CM.validateAction('add_tick', { value: 3 })[0], /"at": \{"x": 606/);
  assert.deepEqual(CM.normalizeArgs('set_review', { status: null }).args, { status: null }, 'null kept where it is a value');
});

test('finishCheck refuses to stop after the first heatmap', () => {
  const { finishCheck, progressNote } = CM;
  const panels = [
    { id: 'a', name: 'Fig 2b', page: 3, ready: true, started: true },
    { id: 'b', name: 'Panel 2', page: 5, ready: false, started: false },
  ];
  const base = { pages: [3, 5], panels, checked: false, refusals: 0 };
  assert.match(finishCheck({ ...base, viewedPages: new Set([3]) }).message, /page 5 was not looked at/);
  const list = finishCheck({ ...base, viewedPages: new Set([3, 5]) });
  assert.ok(list.checklist);
  assert.match(list.message, /page 3: Fig 2b; page 5: no panels/);
  assert.equal(finishCheck({ ...base, viewedPages: new Set([3, 5]), checked: true, refusals: 1 }), null);
  const partial = [{ ...panels[0], ready: false }];
  assert.match(finishCheck({ ...base, panels: partial, viewedPages: new Set([3, 5]) }).message, /only partly calibrated/);
  assert.equal(finishCheck({ ...base, viewedPages: new Set(), refusals: 3 }), null, 'a stuck model can still end');
  assert.match(progressNote({ pages: [3, 5], viewedPages: new Set([3]), panels, currentPage: 3 }), /Page 3 panels: Fig 2b\. .*not looked at yet: 5/);
});

import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { PanelSnapshot } from '../types/index.ts';
import {
  addUsage,
  focusText,
  imagesMessage,
  newUsage,
  nudgeText,
  openingText,
  parseToolCalls,
  splitImages,
} from './run-messages.ts';
import { labelPlace, markBoxes, niceStep, viewNote } from './runner-draw.ts';

test('parseToolCalls parses each call once; bad JSON gives null args', () => {
  const calls = parseToolCalls([
    { id: 'a', function: { name: 'set_ticks', arguments: '{"ticks":[]}' } },
    { id: 'b', function: { name: 'finish', arguments: '' } },
    { id: 'c', function: { name: 'undo', arguments: '{oops' } },
  ]);
  assert.deepEqual(calls, [
    { id: 'a', name: 'set_ticks', args: { ticks: [] } },
    { id: 'b', name: 'finish', args: {} },
    { id: 'c', name: 'undo', args: null },
  ]);
});

test('addUsage adds a response to the totals', () => {
  const u = newUsage();
  addUsage(u, { cost: 0.5, promptTokens: 100, completionTokens: 7, promptTokensDetails: { cachedTokens: 40 } });
  addUsage(u, undefined);
  addUsage(u, { cost: 0.25, promptTokensDetails: { cacheWriteTokens: 9 } });
  assert.deepEqual(u, {
    ...newUsage(),
    llmCost: 0.75,
    promptTokens: 100,
    cachedTokens: 40,
    cacheWriteTokens: 9,
    completionTokens: 7,
  });
});

const panel = {
  id: 'p1',
  name: 'Fig 2f',
  page: 5,
  ready: true,
  review: { status: 'rejected' },
  grid: { rows: 2 },
  colorbar: { scale: 'linear' },
} as unknown as PanelSnapshot;

test('openingText and focusText', () => {
  assert.equal(focusText(null, 'x', true), '');
  const redo = focusText(panel, 'ticks wrong', true);
  assert.equal(
    redo,
    '\n\nThis is a redo. Panel "Fig 2f" (id p1) was rejected with the note: "ticks wrong". Do not add panels. locate_heatmap with panelId "p1" and a description that singles it out, then set_ticks and set_labels, then finish.',
  );
  assert.match(
    focusText(panel, undefined, false),
    /was rejected\. Its current calibration: \{"grid":\{"rows":2\},"colorbar":\{"scale":"linear"\}\}\. Do not add panels\. select_panel it/,
  );
  assert.equal(
    openingText({
      source: { fileName: 'a.pdf', pageCount: 1, width: 800, height: 600 },
      pages: [1],
      panels: [panel],
      focus: '',
      note: 'NOTE',
    }),
    'File: a.pdf (1 page). Process page 1. Page images are 800 × 600 px. Existing panels: [{"id":"p1","name":"Fig 2f","page":5,"ready":true,"review":"rejected"}].\nNOTE',
  );
  assert.match(nudgeText('P.'), /^Continue with the tools\. P\. Call finish only when/);
});

test('splitImages moves images out of a result and keeps its text first', () => {
  const plain = { ok: true, result: 'x' };
  assert.deepEqual(splitImages(plain), { result: plain, images: [] });
  const im = { dataUrl: 'data:1', note: 'First.' };
  const two = splitImages({ ok: true, result: 'Found.', images: [im, { dataUrl: 'data:2', note: 'Second.' }] });
  assert.equal(two.result.result, 'Found. First. Second. The images follow.');
  assert.equal(splitImages({ ok: true, image: im }).result.result, 'First. The image follows.');
  assert.deepEqual(imagesMessage([im]).content, [
    { type: 'text', text: 'First.' },
    { type: 'image_url', imageUrl: { url: 'data:1' } },
  ]);
});

test('runner-draw: ruler steps, view note and label places', () => {
  assert.equal(niceStep(1), 100);
  assert.equal(niceStep(2.56), 50);
  assert.equal(niceStep(0.5), 200);
  assert.equal(
    viewNote({ page: 3, region: { x0: 10, y0: 20.123, x1: 110, y1: 70 }, scale: 2.5, width: 250, height: 125 }),
    'Page 3, region x 10–110, y 20.12–70, drawn at 2.5× (250 × 125 image pixels plus rulers). Image pixel (0, 0) is page point (10, 20.12): page x = 10 + image x / 2.5, page y = 20.12 + image y / 2.5. The rulers on the bottom and right edges show the same page pixels.',
  );
  const boxes = markBoxes([{ x0: 10, y0: 10, x1: 20, y1: 20 }], (p) => ({ x: p.x * 2, y: p.y * 2 }));
  assert.deepEqual(boxes, [{ x0: 17, y0: 17, x1: 43, y1: 43 }]);
  // Right of the box when there is room.
  assert.equal(labelPlace(boxes[0], 20, boxes, 200, 200).x0, 45);
  // Below it when the right side leaves the image.
  const below = labelPlace(boxes[0], 20, boxes, 60, 200);
  assert.deepEqual([below.x0, below.y0], [20, 45]);
  // A neighbour on the right pushes the label below too.
  const next = { x0: 44, y0: 17, x1: 70, y1: 43 };
  assert.equal(labelPlace(boxes[0], 20, [boxes[0], next], 200, 200).y0, 45);
});

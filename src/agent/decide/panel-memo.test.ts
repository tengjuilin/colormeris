import assert from 'node:assert/strict';
import { test } from 'vitest';
import { rectCorners } from '../../core/grid.ts';
import { createProject } from '../../extract/project/project.ts';
import { barSignature, countSignature, gridSignature, panelMemo } from './panel-memo.ts';

test('a value tied to the colorbar is gone once the bar moves, and back when it returns', () => {
  const p = createProject('heatmap').panels[0];
  p.colorbar.start = { x: 10, y: 100 };
  p.colorbar.end = { x: 10, y: 0 };
  const marks = panelMemo<string[]>(barSignature);
  marks.set(p, ['1', '2']);
  assert.deepEqual(marks.get(p), ['1', '2']);
  // Ticks do not change the boxes beside the bar.
  p.colorbar.ticks.push({ id: 't1', x: 10, y: 50, value: 3 });
  assert.deepEqual(marks.get(p), ['1', '2']);
  p.colorbar.end = { x: 10, y: 20 }; // the LLM's own set_colorbar
  assert.equal(marks.get(p), undefined);
  p.colorbar.end = { x: 10, y: 0 }; // undo
  assert.deepEqual(marks.get(p), ['1', '2']);
  marks.delete(p);
  assert.equal(marks.get(p), undefined);
});

test('grid and count signatures: corners, and corners with rows and columns', () => {
  const p = createProject('heatmap').panels[0];
  p.grid.corners = rectCorners({ x: 0, y: 0 }, { x: 50, y: 40 });
  const trimmed = panelMemo<number>(gridSignature);
  const unsure = panelMemo<boolean>(countSignature);
  trimmed.set(p, 1);
  unsure.set(p, true);
  p.grid.rows += 1;
  assert.equal(trimmed.get(p), 1);
  assert.equal(unsure.get(p), undefined);
  p.grid.corners = rectCorners({ x: 0, y: 0 }, { x: 50, y: 44 });
  assert.equal(trimmed.get(p), undefined);
});

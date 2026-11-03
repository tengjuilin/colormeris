import assert from 'node:assert/strict';
import { test } from 'vitest';
import { allSections, sectionVisible } from './sections.ts';

const heatmap = { kind: 'heatmap' as const, sections: ['sec-hm-results'] };
const roi = { kind: 'roi' as const, sections: ['sec-rois', 'sec-scale', 'sec-roi-results'] };
const map = { kind: 'map' as const, sections: ['sec-scale', 'sec-axes'] };

test('sectionVisible: nothing before a file, then the fixed sections and the tool’s own', () => {
  assert.equal(sectionVisible(false, heatmap, 'sec-panels'), false);
  assert.equal(sectionVisible(true, heatmap, 'sec-panels'), true);
  assert.equal(sectionVisible(true, heatmap, 'sec-hm-results'), true);
  assert.equal(sectionVisible(true, heatmap, 'sec-rois'), false);
  assert.equal(sectionVisible(true, roi, 'sec-scale'), true);
});

test('sectionVisible: the Agent card shows for heatmaps only, and only with a file', () => {
  assert.equal(sectionVisible(true, heatmap, 'sec-agent'), true);
  assert.equal(sectionVisible(false, heatmap, 'sec-agent'), false);
  assert.equal(sectionVisible(true, roi, 'sec-agent'), false);
  assert.equal(sectionVisible(true, map, 'sec-agent'), false);
});

test('allSections lists each section once', () => {
  const ids = allSections([heatmap, roi, map]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['sec-panels', 'sec-agent', 'sec-scale', 'sec-axes', 'sec-hm-results'])
    assert.ok(ids.includes(id), id);
});

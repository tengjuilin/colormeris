import assert from 'node:assert/strict';
import { test } from 'vitest';
import { cmapData } from './colormap-library.ts';

test('colormap library unpacks colors on first read', () => {
  const viridis = cmapData.maps.find((m) => m.name === 'viridis');
  assert.ok(viridis);
  assert.equal(viridis.colors.length, 256 * 6);
  assert.equal(viridis.colors.slice(0, 6), '440154');
  assert.equal(viridis.colors.slice(-6), 'fde725');
  assert.ok(!('rgb' in viridis));
});

// Golden outputs of the whole public API (testing-golden.ts). The hashes were
// computed on the Colormeris app's code before these modules became a
// package (main 81a9af9), so they prove the move changed no result. A change
// here is a change in behaviour: say so in the commit and the changelog.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'vitest';
import * as api from './index.ts';
import { goldenCases } from './testing-golden.ts';

const GOLDEN: Record<string, string> = {
  color: 'ca8f176f3488d7ad',
  cvd: '72c7a68fde9f55c8',
  stats: '226ddc904835c234',
  library: '277d349d018f5326',
  match: 'c6ca491783274a08',
  matchMisc: '0a0125bf67f013ef',
  metrics: '037135b46ea71c64',
  metricsMisc: 'e4f6e20bf101e9d9',
  refs: '199b02d0a9e60a4e',
  colorbar: 'a97e0a284e3a64d1',
};

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

test('golden: every public function gives the same results as before the move', () => {
  const out = goldenCases(api);
  assert.deepEqual(Object.keys(out), Object.keys(GOLDEN));
  for (const [key, want] of Object.entries(GOLDEN)) assert.equal(hash(out[key]), want, key);
}, 60_000);

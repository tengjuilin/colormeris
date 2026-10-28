import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import md from './agent-docs.ts';

test('docs/agent.md is up to date (run npm run docs)', () => {
  assert.equal(readFileSync(new URL('../docs/agent.md', import.meta.url), 'utf8'), md);
});

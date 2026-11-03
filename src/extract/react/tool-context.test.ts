import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createToolContext } from './tool-context.ts';

test('createToolContext returns what was set and throws before', () => {
  const ctx = createToolContext<{ n: number }>('setupX');
  assert.throws(() => ctx.get(), /setupX has not run/);
  const value = { n: 1 };
  ctx.set(value);
  assert.equal(ctx.get(), value);
  ctx.set(null);
  assert.throws(() => ctx.get());
});

// @vitest-environment jsdom
// Checks the React test setup: JSX, jsdom and Testing Library work together.
import assert from 'node:assert/strict';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, test } from 'vitest';

afterEach(cleanup);

test('React renders into jsdom', () => {
  render(<button type="button">Hello</button>);
  assert.equal(screen.getByRole('button').textContent, 'Hello');
});

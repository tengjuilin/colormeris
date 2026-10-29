// @vitest-environment jsdom
// BoundInput: draft while focused, model after blur, onCommit on the native change event.
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, test } from 'vitest';
import { BoundInput } from './bound-input.tsx';

afterEach(cleanup);

test('shows the model value and passes input attributes through', () => {
  render(<BoundInput kind="number" value={7} min={1} max={9} aria-label="Rows" />);
  const el = screen.getByLabelText('Rows') as HTMLInputElement;
  assert.equal(el.type, 'number');
  assert.equal(el.value, '7');
  assert.equal(el.min, '1');
});

test('keeps the draft while focused, ignoring model updates, and shows the model after blur', async () => {
  const user = userEvent.setup();
  const inputs: string[] = [];
  const { rerender } = render(<BoundInput value="a" aria-label="Name" onInput={(v) => inputs.push(v)} />);
  const el = screen.getByLabelText('Name') as HTMLInputElement;
  await user.click(el);
  await user.type(el, 'bc');
  assert.equal(el.value, 'abc');
  assert.deepEqual(inputs, ['ab', 'abc']);
  // The model changes underneath (e.g. the model rejected the text): the draft stays.
  rerender(<BoundInput value="a" aria-label="Name" onInput={(v) => inputs.push(v)} />);
  assert.equal(el.value, 'abc');
  rerender(<BoundInput value="z" aria-label="Name" onInput={(v) => inputs.push(v)} />);
  assert.equal(el.value, 'abc');
  await user.tab();
  assert.equal(el.value, 'z');
});

test('a number field can hold "" while typing', async () => {
  const user = userEvent.setup();
  render(<BoundInput kind="number" value={5} aria-label="Rows" />);
  const el = screen.getByLabelText('Rows') as HTMLInputElement;
  await user.click(el);
  await user.clear(el);
  assert.equal(el.value, '');
  await user.type(el, '12');
  assert.equal(el.value, '12');
});

test('onFocus fires, and onCommit fires on the native change event with the latest handler', () => {
  const log: string[] = [];
  const { rerender } = render(
    <BoundInput value="a" aria-label="Name" onFocus={() => log.push('focus')} onCommit={(v) => log.push(`old:${v}`)} />,
  );
  const el = screen.getByLabelText('Name') as HTMLInputElement;
  fireEvent.focus(el);
  rerender(
    <BoundInput
      value="a"
      aria-label="Name"
      onFocus={() => log.push('focus')}
      onCommit={(v) => log.push(`commit:${v}`)}
    />,
  );
  fireEvent.change(el, { target: { value: 'q' } });
  assert.deepEqual(log, ['focus', 'commit:q']);
});

test('textarea kind renders a textarea', () => {
  render(<BoundInput kind="textarea" value={'a\nb'} rows={3} aria-label="Labels" />);
  const el = screen.getByLabelText('Labels');
  assert.equal(el.tagName, 'TEXTAREA');
  assert.equal((el as HTMLTextAreaElement).value, 'a\nb');
});

// @vitest-environment jsdom
// Card, field, chip, option and message components render the classes the sidebar CSS expects.
import assert from 'node:assert/strict';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, test } from 'vitest';
import {
  Actions,
  Badge,
  CardHead,
  Check,
  Chip,
  ChipList,
  Field,
  Fields,
  Hint,
  InputPair,
  Notice,
  Options,
  SplitActions,
} from './index.ts';

afterEach(cleanup);

test('CardHead puts the tag in the h2, the badge right after it and the actions last', () => {
  const { container } = render(
    <CardHead
      title="Grid"
      tag="optional"
      badge={{ text: '3 × 4', ok: true }}
      actions={<button type="button">x</button>}
    />,
  );
  const head = container.querySelector('.card-head')!;
  assert.deepEqual(
    [...head.children].map((c) => c.className || c.tagName),
    ['H2', 'badge ok', 'head-actions'],
  );
  assert.equal(head.querySelector('h2 .tag')!.textContent, 'optional');
});

test('Badge is ok or todo', () => {
  const { container } = render(
    <>
      <Badge text="a" ok />
      <Badge text="b" ok={false} />
    </>,
  );
  assert.deepEqual(
    [...container.children].map((c) => c.className),
    ['badge ok', 'badge todo'],
  );
});

test('row containers', () => {
  const { container } = render(
    <>
      <Actions>a</Actions>
      <SplitActions>b</SplitActions>
      <Fields>c</Fields>
      <InputPair>d</InputPair>
    </>,
  );
  assert.deepEqual(
    [...container.children].map((c) => c.className),
    ['card-actions', 'card-actions split', 'fields', 'input-pair'],
  );
});

test('Field is a label.field, .stack for textareas, with its title', () => {
  const { container } = render(
    <>
      <Field label="Rows" title="How many">
        <input />
      </Field>
      <Field label="Labels" stack>
        <textarea />
      </Field>
    </>,
  );
  const [a, b] = [...container.querySelectorAll('label')];
  assert.equal(a.className, 'field');
  assert.equal(a.title, 'How many');
  assert.ok(a.textContent!.startsWith('Rows'));
  assert.equal(b.className, 'field stack');
});

test('Check reports the new checked state', () => {
  let got: boolean | null = null;
  render(<Check label="Reversed" checked={false} onChange={(c) => (got = c)} title="t" />);
  const box = screen.getByRole('checkbox', { name: 'Reversed' });
  box.click();
  assert.equal(got, true);
  assert.equal(box.closest('label')!.className, 'check');
});

test('Chip: pressed, label, meta and status dot; ChipList wraps each in an li', () => {
  const { container } = render(
    <ChipList>
      <Chip pressed dot="rejected" meta="3">
        Fig 1
      </Chip>
      <Chip pressed={false} dot="pending">
        Fig 2
      </Chip>
      <Chip>Page 3</Chip>
    </ChipList>,
  );
  assert.equal(container.querySelector('ul')!.className, 'chip-list');
  assert.equal(container.querySelectorAll('ul > li').length, 3);
  const chips = [...container.querySelectorAll<HTMLElement>('button.chip')];
  assert.equal(chips[0].getAttribute('aria-pressed'), 'true');
  assert.equal(chips[1].getAttribute('aria-pressed'), 'false');
  assert.equal(chips[2].hasAttribute('aria-pressed'), false);
  assert.equal(chips[0].querySelector('.status-dot')!.className, 'status-dot rejected');
  assert.equal(chips[1].querySelector('.status-dot')!.className, 'status-dot');
  assert.equal(chips[0].querySelector('.chip-label')!.textContent, 'Fig 1');
  assert.equal(chips[0].querySelector('.chip-meta')!.textContent, '3');
  assert.equal(chips[2].querySelector('.status-dot'), null);
});

test('an empty ChipList is an empty ul', () => {
  const { container } = render(<ChipList />);
  assert.equal(container.querySelector('ul')!.childElementCount, 0);
});

test('Options renders details.options with a summary note and a body', () => {
  const { container } = render(
    <Options summary="Row and column labels" note="3 rows">
      <p>inside</p>
    </Options>,
  );
  const d = container.querySelector('details')!;
  assert.equal(d.className, 'options');
  assert.equal(d.querySelector('summary .summary-note')!.textContent, '3 rows');
  assert.equal(d.querySelector('.options-body p')!.textContent, 'inside');
});

test('Hint and Notice render nothing when empty', () => {
  const { container } = render(
    <>
      <Hint>{''}</Hint>
      <Hint>{null}</Hint>
      <Notice>{false}</Notice>
      <Notice />
    </>,
  );
  assert.equal(container.innerHTML, '');
  render(
    <>
      <Hint id="h">Measured</Hint>
      <Notice>Problem</Notice>
    </>,
  );
  assert.equal(screen.getByText('Measured').className, 'hint');
  assert.equal(screen.getByText('Measured').id, 'h');
  assert.equal(screen.getByText('Problem').className, 'notice');
});

test('Hint with an id stays as an empty element; neutral Badge; Field as div; Options controlled', () => {
  const { container } = render(
    <>
      <Hint id="h" />
      <Badge text="x" className="big" />
      <Field as="div" label="Colormap">
        <i />
      </Field>
      <Options summary="S" open onToggle={() => {}}>
        b
      </Options>
    </>,
  );
  assert.equal(container.querySelector('#h')!.outerHTML, '<p id="h" class="hint"></p>');
  assert.equal(container.querySelector('.badge')!.className, 'badge big');
  assert.equal(container.querySelector('div.field > span')!.textContent, 'Colormap');
  assert.equal(container.querySelector('details')!.open, true);
});

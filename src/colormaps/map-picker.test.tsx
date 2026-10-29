// @vitest-environment jsdom
// Tests of the colormap picker combobox: filtering, keyboard, _r, restore on blur, ARIA.
import assert from 'node:assert/strict';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, test } from 'vitest';
import { MapPicker } from './map-picker.tsx';

afterEach(cleanup);

// jsdom has no canvas; the picker skips painting when there is no 2D context.
HTMLCanvasElement.prototype.getContext = () => null;

function setup(value: string | null = 'viridis') {
  const chosen: [string, boolean][] = [];
  render(<MapPicker id="t" label="Colormap" value={value} onChoose={(n, r) => chosen.push([n, r])} />);
  const input = screen.getByRole('combobox', { name: 'Colormap' }) as HTMLInputElement;
  return { input, chosen, user: userEvent.setup() };
}

const names = () => [...document.querySelectorAll<HTMLElement>('[role=option]')].map((o) => o.dataset.name);

test('closed at first, shows the value, and opens with all maps on focus', async () => {
  const { input, user } = setup();
  assert.equal(input.value, 'viridis');
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  assert.equal(input.getAttribute('aria-controls'), 't-maps');
  await user.click(input);
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  assert.ok(names().length > 100);
  assert.ok(document.querySelector('.cmap-rc-group'));
  assert.equal(document.querySelector('[aria-selected=true]')?.getAttribute('data-name'), 'viridis');
});

test('typing filters, prefix matches first', async () => {
  const { input, user } = setup(null);
  await user.click(input);
  await user.keyboard('vir');
  const list = names();
  assert.ok(list.length > 0 && list.length < 50);
  assert.equal(list[0]?.toLowerCase().startsWith('vir'), true);
  assert.ok(list.every((n) => n?.toLowerCase().includes('vir')));
  assert.equal(input.getAttribute('aria-activedescendant'), `t-maps-${list[0]}`);
  await user.keyboard('zzzz');
  assert.equal(names().length, 0);
  assert.ok(document.querySelector('.cmap-rc-none'));
});

test('arrow keys and Enter pick the active map', async () => {
  const { input, chosen, user } = setup(null);
  await user.click(input);
  await user.keyboard('g{ArrowDown}');
  const second = names()[1];
  assert.equal(input.getAttribute('aria-activedescendant'), `t-maps-${second}`);
  await user.keyboard('{Enter}');
  assert.deepEqual(chosen, [[second, false]]);
  assert.equal(input.getAttribute('aria-expanded'), 'false');
});

test('name_r counts as reversed', async () => {
  const { input, chosen, user } = setup(null);
  await user.click(input);
  await user.keyboard('viridis_r{Enter}');
  assert.deepEqual(chosen, [['viridis', true]]);
});

test('mouse pick', async () => {
  const { input, chosen, user } = setup(null);
  await user.click(input);
  await user.keyboard('magma');
  await user.click(document.getElementById('t-maps-magma') as HTMLElement);
  assert.deepEqual(chosen, [['magma', false]]);
});

test('Escape restores the value and prevents default', async () => {
  const { input, user } = setup();
  await user.click(input);
  await user.keyboard('abc');
  let prevented = false;
  const seen = (e: KeyboardEvent) => {
    prevented = e.defaultPrevented;
  };
  document.addEventListener('keydown', seen);
  await user.keyboard('{Escape}');
  document.removeEventListener('keydown', seen);
  assert.equal(prevented, true);
  assert.equal(input.value, 'viridis');
  assert.equal(input.getAttribute('aria-expanded'), 'false');
});

test('leaving with unmatched text restores the field; exact text picks', async () => {
  const { input, chosen, user } = setup();
  await user.click(input);
  await user.keyboard('nonsense');
  await user.tab();
  assert.equal(input.value, 'viridis');
  assert.equal(chosen.length, 0);
  await user.click(input);
  await user.keyboard('PLASMA');
  await user.tab();
  assert.deepEqual(chosen, [['plasma', false]]);
});

test('typed text is not overwritten by a new value while focused', async () => {
  const { input, user } = setup();
  await user.click(input);
  await user.keyboard('ma');
  assert.equal(input.value, 'ma');
});

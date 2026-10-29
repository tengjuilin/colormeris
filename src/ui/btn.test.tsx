// @vitest-environment jsdom
// Btn, MainStep and IconBtn render the classes and attributes of the static sidebar buttons.
import assert from 'node:assert/strict';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, test } from 'vitest';
import { defaultSettings, hotkeyTitle } from '../extract/settings/settings.ts';
import type { Settings } from '../types/index.ts';
import { Btn, IconBtn, MainStep } from './btn.tsx';
import { SettingsProvider } from './settings-context.tsx';

afterEach(cleanup);

test('Btn is a type="button" .btn with variant, icon and block', () => {
  render(
    <Btn variant="primary" icon="place" block>
      Place
    </Btn>,
  );
  const b = screen.getByRole('button', { name: 'Place' });
  assert.equal(b.getAttribute('type'), 'button');
  assert.equal(b.className, 'btn primary block');
  assert.equal(b.dataset.icon, 'place');
  assert.equal(b.hasAttribute('aria-pressed'), false);
});

test('pressed sets .active and aria-pressed together', () => {
  const { rerender } = render(<Btn pressed>A</Btn>);
  const b = screen.getByRole('button');
  assert.equal(b.className, 'btn active');
  assert.equal(b.getAttribute('aria-pressed'), 'true');
  rerender(<Btn pressed={false}>A</Btn>);
  assert.equal(b.className, 'btn');
  assert.equal(b.getAttribute('aria-pressed'), 'false');
});

test('MainStep is block-wide; IconBtn is icon-only with title and aria-label', () => {
  render(
    <>
      <MainStep variant="primary">Go</MainStep>
      <IconBtn icon="trash" variant="danger" label="Delete the panel" />
    </>,
  );
  assert.equal(screen.getByRole('button', { name: 'Go' }).className, 'btn primary block');
  const icon = screen.getByRole('button', { name: 'Delete the panel' });
  assert.equal(icon.className, 'btn danger icon-only');
  assert.equal(icon.title, 'Delete the panel');
  assert.equal(icon.dataset.icon, 'trash');
});

test('hotkey writes data-hotkey, data-title, data-key and title from hotkeyTitle', () => {
  render(
    <Btn hotkey="grid" title="Shortcut: {key}">
      Grid
    </Btn>,
  );
  const b = screen.getByRole('button');
  const want = hotkeyTitle('Shortcut: {key}', defaultSettings().hotkeys.grid, (c) => c);
  assert.equal(b.dataset.hotkey, 'grid');
  assert.equal(b.dataset.title, 'Shortcut: {key}');
  assert.equal(b.dataset.key, want.key);
  assert.equal(b.title, want.title);
  assert.ok(want.key.length > 0);
  assert.equal(b.hasAttribute('data-no-cap'), false);
});

test('noCap marks the button, and a title without a hotkey stays as given', () => {
  render(
    <>
      <Btn hotkey="undo" noCap title="Undo">
        U
      </Btn>
      <Btn title="Plain">P</Btn>
    </>,
  );
  assert.equal(screen.getByRole('button', { name: 'U' }).hasAttribute('data-no-cap'), true);
  const plain = screen.getByRole('button', { name: 'P' });
  assert.equal(plain.title, 'Plain');
  assert.equal(plain.hasAttribute('data-key'), false);
});

test('the cap follows the settings when the dialog reports a change', () => {
  const settings: Settings = defaultSettings();
  const listeners: (() => void)[] = [];
  const source = {
    get: () => settings,
    onChange: (fn: () => void) => {
      listeners.push(fn);
      return () => {
        listeners.splice(listeners.indexOf(fn), 1);
      };
    },
  };
  render(
    <SettingsProvider source={source} mac={false}>
      <Btn hotkey="grid" title="Shortcut: {key}">
        Grid
      </Btn>
    </SettingsProvider>,
  );
  const b = screen.getByRole('button');
  settings.hotkeys.grid = ['Mod+Shift+Y'];
  act(() => {
    for (const fn of listeners) fn();
  });
  assert.equal(b.dataset.key, 'Ctrl+Shift+Y');
  assert.equal(b.title, 'Shortcut: Ctrl+Shift+Y');
});

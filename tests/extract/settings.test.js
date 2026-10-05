import { test } from 'node:test';
import assert from 'node:assert/strict';
import CM from '../load.js';

const { HOTKEY_ACTIONS, defaultSettings, normalizeSettings, normalizeCombo, comboFromEvent, findHotkey, formatCombo, serializeSettings, parseSettings, buildSettingsZip, readSettingsFile } = CM;
// The vendored UMD build sets globalThis.JSZip when loaded as a module.
await import('../../assets/vendor/jszip/jszip.min.js');
const { JSZip } = globalThis;

test('default hotkeys are unique and canonical', () => {
  const all = HOTKEY_ACTIONS.flatMap((a) => a.keys);
  assert.equal(new Set(all).size, all.length);
  for (const k of all) assert.equal(normalizeCombo(k), k);
});

test('normalizeSettings fills defaults and clamps bad values', () => {
  assert.deepEqual(normalizeSettings(null), defaultSettings());
  const s = normalizeSettings({
    agent: { minConfidence: 3, maxSteps: 2.4, base: ' http://localhost:8787/api/v1 ', key: 7 },
    matching: { heatmap: { distance: 'bogus', maxDeltaE: 5 }, roi: { grayChroma: -4 } },
    hotkeys: { grid: ['shift+g', 'nonsense+x', 'Escape'], unknownAction: ['Q'] },
  });
  assert.equal(s.agent.minConfidence, 1);
  assert.equal(s.agent.maxSteps, 5);
  assert.equal(s.agent.base, 'http://localhost:8787/api/v1');
  assert.equal(s.agent.key, '');
  assert.deepEqual(s.matching.heatmap, { distance: 'de2000', maxDeltaE: 5 });
  assert.equal(s.matching.roi.grayChroma, 0);
  assert.equal(s.matching.roi.maxDeltaE, 20);
  assert.deepEqual(s.hotkeys.grid, ['Shift+G']);
  assert.equal('unknownAction' in s.hotkeys, false);
  assert.deepEqual(s.hotkeys.fit, ['F']);
});

test('normalizeCombo orders modifiers and refuses fixed keys', () => {
  assert.equal(normalizeCombo('shift+ctrl+z'), 'Mod+Shift+Z');
  assert.equal(normalizeCombo('Cmd++'), 'Mod++');
  assert.equal(normalizeCombo('+'), '+');
  assert.equal(normalizeCombo('Escape'), '');
  assert.equal(normalizeCombo('Space'), '');
  assert.equal(normalizeCombo('Mod+Enter'), 'Mod+Enter');
  assert.equal(normalizeCombo('Hyper+K'), '');
});

test('comboFromEvent reads keydown events', () => {
  assert.equal(comboFromEvent({ key: 'g' }), 'G');
  assert.equal(comboFromEvent({ key: 'G', shiftKey: true }), 'Shift+G');
  // Mod is Ctrl on Windows and Linux, ⌘ on a Mac; the other one is the system's.
  assert.equal(comboFromEvent({ key: 'z', ctrlKey: true, shiftKey: true }), 'Mod+Shift+Z');
  assert.equal(comboFromEvent({ key: 'z', metaKey: true, shiftKey: true }, true), 'Mod+Shift+Z');
  assert.equal(comboFromEvent({ key: 'z', metaKey: true }), '');
  assert.equal(comboFromEvent({ key: 'z', ctrlKey: true }, true), '');
  // Other layouts: a Cyrillic key in the place of C is C.
  assert.equal(comboFromEvent({ key: 'с', code: 'KeyC', ctrlKey: true }), 'Mod+C');
  // Shift is part of the character for "+".
  assert.equal(comboFromEvent({ key: '+', shiftKey: true }), '+');
  // Alt+G types © on a Mac; the key's position names it.
  assert.equal(comboFromEvent({ key: '©', code: 'KeyG', altKey: true }), 'Alt+G');
  assert.equal(comboFromEvent({ key: 'ArrowLeft', shiftKey: true }), 'Shift+ArrowLeft');
  assert.equal(comboFromEvent({ key: 'Shift', shiftKey: true }), '');
});

test('findHotkey and formatCombo', () => {
  const { hotkeys } = defaultSettings();
  assert.equal(findHotkey(hotkeys, 'Mod+Y'), 'redo');
  assert.equal(findHotkey(hotkeys, '='), 'zoomIn');
  assert.equal(findHotkey(hotkeys, 'Q'), null);
  assert.equal(formatCombo('Mod+Shift+Z'), 'Ctrl+Shift+Z');
  assert.equal(formatCombo('Mod+Shift+Z', true), '⇧⌘Z');
  assert.equal(formatCombo('Mod+Alt+Shift+K', true), '⌥⇧⌘K');
  assert.equal(formatCombo('Backspace', true), '⌫');
  assert.equal(CM.isMacPlatform({ userAgentData: { platform: 'macOS' } }), true);
  assert.equal(CM.isMacPlatform({ platform: 'Win32' }), false);
  assert.equal(CM.isMacPlatform({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }), true);
  assert.equal(formatCombo('ArrowLeft'), '←');
});

test('settings files leave out the key unless asked', () => {
  const s = defaultSettings();
  s.agent.key = 'sk-or-test';
  s.agent.rememberKey = true;
  const plain = serializeSettings(s);
  assert.equal('key' in plain.agent, false);
  assert.equal(parseSettings(JSON.parse(JSON.stringify(plain))).hasKey, false);
  const withKey = parseSettings(JSON.parse(JSON.stringify(serializeSettings(s, { includeKey: true }))));
  assert.equal(withKey.hasKey, true);
  assert.deepEqual(withKey.settings, s);
  assert.throws(() => parseSettings({ schema: 'colormeris-project' }), /Not a Colormeris settings file/);
  assert.throws(() => parseSettings({ schema: 'colormeris-settings', version: 99 }), /newer/);
});

test('settings zip round-trips', async () => {
  const s = defaultSettings();
  s.agent.maxSteps = 12;
  s.matching.roi.grayChroma = 15;
  s.hotkeys.grid = ['Alt+G'];
  s.hotkeys.fit = [];
  const blob = await buildSettingsZip(JSZip, s);
  const back = await readSettingsFile(JSZip, blob);
  assert.equal(back.hasKey, false);
  assert.deepEqual(back.settings, s);
  const json = new Blob([JSON.stringify(serializeSettings(s))]);
  assert.deepEqual((await readSettingsFile(JSZip, json, 'settings.json')).settings, s);
});

test('hotkeys are grouped and tools may share keys', () => {
  const { HOTKEY_GROUPS, hotkeyClashes } = CM;
  const groups = new Set(HOTKEY_GROUPS.map((g) => g.id));
  for (const a of HOTKEY_ACTIONS) assert.ok(groups.has(a.group), `${a.id} has a known group`);
  // A ROI and a Map action on the same key: each tool finds its own.
  const hotkeys = { ...defaultSettings().hotkeys, ellipse: ['X'] };
  assert.equal(findHotkey(hotkeys, 'X', 'roi'), 'ellipse');
  assert.equal(findHotkey(hotkeys, 'X', 'map'), 'xtick');
  assert.equal(findHotkey(hotkeys, 'X', 'heatmap'), null);
  // So they do not clash; a key of an action of every tool does.
  assert.deepEqual(hotkeyClashes(hotkeys, 'X', 'ellipse'), []);
  assert.deepEqual(hotkeyClashes(hotkeys, 'F', 'xtick'), ['fit']);
  assert.deepEqual(hotkeyClashes(hotkeys, 'L', 'fit'), ['profile']);
});

test('colors default, normalize and round-trip', () => {
  const { COLOR_ITEMS, COLOR_DEFAULTS, hexToRgb } = CM;
  const d = defaultSettings();
  assert.equal(d.colors.grid, '#e22bd0');
  assert.equal(d.colors.roiPalette.length, 8);
  for (const item of COLOR_ITEMS) assert.deepEqual(d.colors[item.id], COLOR_DEFAULTS[item.id]);
  const s = normalizeSettings({ colors: { grid: '#ABCDEF', bar: 'red', profilePalette: ['#000000', 'bad'] } });
  assert.equal(s.colors.grid, '#abcdef');
  assert.equal(s.colors.bar, COLOR_DEFAULTS.bar); // not #rrggbb
  assert.deepEqual(s.colors.profilePalette, ['#000000', ...COLOR_DEFAULTS.profilePalette.slice(1)]);
  assert.deepEqual(parseSettings(JSON.parse(JSON.stringify(serializeSettings(s)))).settings.colors, s.colors);
  assert.deepEqual(hexToRgb('#ff8001'), [255, 128, 1]);
});

import type { Settings, SettingsUi, ToolKind, Workspace } from '../../types/index.ts';
import { flushSafely } from '../../ui/flush.ts';
import {
  defaultSettings,
  formatCombo,
  hotkeyTitle,
  isMacPlatform,
  MATCHING_DEFAULTS,
  normalizeSettings,
} from './settings.ts';
import { createDialogUi, type SettingsCtl } from './settings-ctl.ts';
import { mountSettingsDialog } from './settings-ui.tsx';

// Settings dialog: agent connection, matching defaults, hotkeys, overlay colors, and settings zips. This file
// owns the settings object (ws.settings, see settings.ts for its shape), its storage and change listeners,
// and the <dialog> element; the content is React (settings-ui.tsx and the *-pane.tsx files). Every change is
// saved in localStorage at once. The API key is only stored when "Remember" is ticked, otherwise it lasts for
// this visit.

const STORE = 'colormeris.settings';
const OLD_AGENT_STORE = 'colormeris.agent'; // before the dialog, the Agent card saved here

const isMac = isMacPlatform(navigator);

function loadStored(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) as string);
    if (raw) return normalizeSettings(raw);
    const old = JSON.parse(localStorage.getItem(OLD_AGENT_STORE) as string);
    if (old) return normalizeSettings({ agent: { ...old, rememberKey: !!old.key } });
  } catch {
    // Unreadable or unavailable storage: start from the defaults.
  }
  return defaultSettings();
}

export function setupSettings(ws: Workspace): SettingsUi {
  const { $ } = ws;
  const settings = loadStored();
  ws.settings = settings;
  const listeners: ((s: Settings) => void)[] = [];
  const ui = createDialogUi();

  function save() {
    const stored = structuredClone(settings);
    if (!stored.agent.rememberKey) stored.agent.key = '';
    try {
      localStorage.setItem(STORE, JSON.stringify(stored));
      localStorage.removeItem(OLD_AGENT_STORE);
    } catch {
      // Storage can be unavailable (private windows, file://); settings then last for this visit.
    }
  }
  function notifyOnly() {
    const run = () => {
      for (const fn of [...listeners]) fn(settings);
    };
    // Rendered at once, so a field that commits right after finds its model value current.
    if (!flushSafely(run)) run();
  }
  function changed() {
    save();
    notifyOnly();
  }

  // Replace every value (import, reset) in place, so ws.settings stays the same object.
  function replaceAll(next: Settings) {
    for (const k of Object.keys(settings)) delete (settings as unknown as Record<string, unknown>)[k];
    Object.assign(settings, next);
    changed();
    for (const kind of Object.keys(MATCHING_DEFAULTS) as ToolKind[]) ws.applyMatching(kind, settings.matching[kind]);
  }

  // Sidebar marks (card dots, flagged and highlighted table cells) use CSS variables (base.css); they follow
  // the overlay colors.
  function applyCssColors() {
    const root = document.documentElement.style;
    for (const [name, id] of [
      ['--grid-color', 'grid'],
      ['--bar-color', 'bar'],
      ['--flag-color', 'flag'],
      ['--highlight-color', 'highlight'],
    ])
      root.setProperty(name, settings.colors[id] as string);
  }
  listeners.push(applyCssColors);
  applyCssColors();

  // Tooltips name the current keys: data-title, with {key} where the keys go (otherwise they are added in
  // parentheses). Buttons also show the first key as a key cap (data-key, drawn by CSS). Buttons rendered by
  // React (data-react) write their own title and key cap; this is for the static top bar and view bar.
  const label = (combo: string) => formatCombo(combo, isMac);
  function updateTitles() {
    for (const el of document.querySelectorAll<HTMLElement>('[data-hotkey]:not([data-react])')) {
      const { title, key } = hotkeyTitle(el.dataset.title || '', settings.hotkeys[el.dataset.hotkey!] || [], label);
      el.dataset.key = key;
      el.title = title;
    }
  }
  listeners.push(updateTitles);
  updateTitles();

  // ------------------------------------------------------------ dialog

  const ctl: SettingsCtl = { ws, settings, ui, mac: isMac, changed, notifyOnly, replaceAll, applyCssColors };
  const source = {
    get: () => settings,
    onChange: (fn: () => void) => onChange(fn),
  };
  const dialog = $('settings-dialog') as unknown as HTMLDialogElement;
  mountSettingsDialog(dialog, ctl, source);

  function open(tab: string | null = null) {
    // The panes render (the first time) before the dialog shows, and re-read the settings.
    if (!flushSafely(() => ui.open(tab))) ui.open(tab);
    if (!dialog.open) dialog.showModal();
  }
  $('btn-settings').addEventListener('click', () => open());
  // Clicking the backdrop closes the dialog.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('cancel', (e) => {
    if (ui.get().capturing) e.preventDefault();
  });
  dialog.addEventListener('close', () => ui.setCapturing(null));

  function onChange(fn: () => void) {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  return {
    get: () => settings,
    save: changed,
    open,
    onChange,
  };
}

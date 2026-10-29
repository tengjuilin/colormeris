import { createContext, useContext } from 'react';
import type { Settings, Workspace } from '../../types/index.ts';

// What the Settings dialog's React panes share: the UI state of the dialog (tab, hotkey capture), kept in a
// tiny external store because the controller (settings-dialog.ts) also needs it (Esc while capturing, close),
// and the controller's functions that change settings. The settings object itself is mutated in place.

export interface DialogUiState {
  tab: string;
  /** Id of the hotkey action waiting for a key. */
  capturing: string | null;
  /** The panes render only after the first open, so page load pays nothing for them. */
  shown: boolean;
  /** Bumped on every open, so panes re-read values changed while the dialog was closed. */
  rev: number;
}

export function createDialogUi() {
  let state: DialogUiState = { tab: 'agent', capturing: null, shown: false, rev: 0 };
  const subs = new Set<() => void>();
  const set = (patch: Partial<DialogUiState>) => {
    state = { ...state, ...patch };
    for (const fn of [...subs]) fn();
  };
  return {
    get: () => state,
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    open(tab: string | null) {
      set({ shown: true, rev: state.rev + 1, capturing: null, ...(tab ? { tab } : {}) });
    },
    setTab: (tab: string) => set({ tab, capturing: null }),
    setCapturing(id: string | null) {
      if (state.capturing !== id) set({ capturing: id });
    },
  };
}
export type DialogUi = ReturnType<typeof createDialogUi>;

export interface SettingsCtl {
  ws: Workspace;
  /** ws.settings: the same object for the whole visit. */
  settings: Settings;
  ui: DialogUi;
  /** Mac key names and chords. */
  mac: boolean;
  /** Save to localStorage and tell the listeners (title caps, overlay colors, React components). */
  changed: () => void;
  /** Tell the listeners without saving (every keystroke of the key field). */
  notifyOnly: () => void;
  /** Replace every value (import, reset) in place. */
  replaceAll: (next: Settings) => void;
  applyCssColors: () => void;
}

export const SettingsCtlContext = createContext<SettingsCtl | null>(null);

export function useSettingsCtl(): SettingsCtl {
  const ctl = useContext(SettingsCtlContext);
  if (!ctl) throw new Error('useSettingsCtl needs a SettingsCtlContext provider');
  return ctl;
}

// Gives components the settings (for hotkey caps and tooltips) and re-renders them when the settings dialog
// reports a change. Without a provider, components see the default settings and never update (tests, previews).
import { createContext, type ReactNode, useContext, useMemo, useSyncExternalStore } from 'react';
import { defaultSettings, formatCombo, isMacPlatform } from '../extract/settings/settings.ts';
import type { Settings, SettingsSource } from '../types/index.ts';

interface SettingsValue {
  get: () => Settings;
  mac: boolean;
  subscribe: (fn: () => void) => () => void;
  getVersion: () => number;
}

const FALLBACK_SETTINGS = defaultSettings();
const FALLBACK: SettingsValue = {
  get: () => FALLBACK_SETTINGS,
  mac: false,
  subscribe: () => () => {},
  getVersion: () => 0,
};

const SettingsContext = createContext<SettingsValue>(FALLBACK);

// The settings object is mutated in place, so the snapshot is a counter bumped on every change.
function makeValue(source: SettingsSource, mac: boolean): SettingsValue {
  let version = 0;
  return {
    get: source.get,
    mac,
    subscribe: (fn) =>
      source.onChange(() => {
        version++;
        fn();
      }),
    getVersion: () => version,
  };
}

export function SettingsProvider({
  source,
  mac,
  children,
}: {
  source: SettingsSource;
  /** Show Mac key names; by default taken from the browser. */
  mac?: boolean;
  children: ReactNode;
}) {
  const isMac = mac ?? isMacPlatform(navigator);
  const value = useMemo(() => makeValue(source, isMac), [source, isMac]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

/** The current settings, and `label` to write a key combo the way this platform shows it. */
export function useSettings() {
  const value = useContext(SettingsContext);
  useSyncExternalStore(value.subscribe, value.getVersion);
  return { settings: value.get(), label: (combo: string) => formatCombo(combo, value.mac) };
}

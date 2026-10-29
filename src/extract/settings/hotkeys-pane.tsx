// Hotkeys pane of the Settings dialog: one fieldset per group (HOTKEY_GROUPS) with a table of its actions.
// Change waits for a key (a capture-phase listener on window, so the key reaches neither the workspace nor
// the viewer); a key already used by an action that can be active together moves here with a toast.
import { useEffect, useSyncExternalStore } from 'react';
import type { HotkeyAction } from '../../types/index.ts';
import { Btn, useSettings } from '../../ui/index.ts';
import {
  comboFromEvent,
  defaultSettings,
  formatCombo,
  HOTKEY_ACTIONS,
  HOTKEY_GROUPS,
  hotkeyClashes,
  normalizeCombo,
} from './settings.ts';
import { useSettingsCtl } from './settings-ctl.ts';

function HotkeyRow({ action }: { action: HotkeyAction }) {
  const ctl = useSettingsCtl();
  const { settings, label } = useSettings();
  const capturing = useSyncExternalStore(ctl.ui.subscribe, () => ctl.ui.get().capturing) === action.id;
  const combos = settings.hotkeys[action.id] || [];
  const isDefault = JSON.stringify(combos) === JSON.stringify(action.keys);
  const setKeys = (keys: string[]) => {
    ctl.settings.hotkeys[action.id] = keys;
    ctl.changed();
  };
  return (
    <tr className={capturing ? 'capturing' : ''}>
      <td>{action.label}</td>
      <td>
        {capturing ? (
          'Press a key… (Esc cancels)'
        ) : combos.length ? (
          combos.map((c) => <kbd key={c}>{label(c)}</kbd>)
        ) : (
          <span className="muted">none</span>
        )}
      </td>
      <td>
        <Btn className="small" onClick={() => ctl.ui.setCapturing(capturing ? null : action.id)}>
          {capturing ? 'Cancel' : 'Change'}
        </Btn>{' '}
        <Btn
          className="small"
          disabled={isDefault}
          title={`Default: ${action.keys.map(label).join(', ')}`}
          onClick={() => setKeys([...action.keys])}
        >
          Reset
        </Btn>{' '}
        <Btn className="small" disabled={!combos.length} onClick={() => setKeys([])}>
          Clear
        </Btn>
      </td>
    </tr>
  );
}

/** Listens for the new key while an action is capturing. */
function useCapture() {
  const ctl = useSettingsCtl();
  const capturing = useSyncExternalStore(ctl.ui.subscribe, () => ctl.ui.get().capturing);
  useEffect(() => {
    if (!capturing) return;
    const { ws, settings, ui, mac } = ctl;
    const label = (combo: string) => formatCombo(combo, mac);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') return ui.setCapturing(null);
      const raw = comboFromEvent(e, mac);
      if (!raw) {
        // Control on a Mac and the Windows key belong to the system.
        const system = !['Control', 'Meta', 'OS'].includes(e.key) && (mac ? e.ctrlKey : e.metaKey);
        if (system)
          ws.toast(
            mac
              ? 'Control (⌃) chords belong to macOS; use ⌘ instead.'
              : 'Windows-key chords belong to Windows; use Ctrl instead.',
            true,
          );
        return; // otherwise a modifier on its own: wait for the key
      }
      const combo = normalizeCombo(raw);
      if (!combo) {
        ws.toast(`${label(raw)} is fixed and cannot be a hotkey.`, true);
        return;
      }
      // Only actions that can be active together clash; another tool's action keeps the key.
      for (const other of hotkeyClashes(settings.hotkeys, combo, capturing)) {
        settings.hotkeys[other] = settings.hotkeys[other].filter((c) => c !== combo);
        const a = HOTKEY_ACTIONS.find((x) => x.id === other);
        ws.toast(`${label(combo)} moved from “${HOTKEY_GROUPS.find((g) => g.id === a?.group)?.label}: ${a?.label}”.`);
      }
      settings.hotkeys[capturing] = [combo];
      ui.setCapturing(null);
      ctl.changed();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, ctl]);
}

export function HotkeysPane() {
  const ctl = useSettingsCtl();
  useCapture();
  return (
    <>
      <div id="hotkey-list" className="hotkey-list">
        {HOTKEY_GROUPS.map((group) => (
          <fieldset key={group.id}>
            <legend>{group.label}</legend>
            <table className="hotkeys" aria-label={`${group.label} hotkeys`}>
              <tbody>
                {HOTKEY_ACTIONS.filter((a) => a.group === group.id).map((a) => (
                  <HotkeyRow key={a.id} action={a} />
                ))}
              </tbody>
            </table>
          </fieldset>
        ))}
      </div>
      <div className="row">
        <Btn
          className="small"
          id="hotkeys-reset"
          onClick={() => {
            ctl.ui.setCapturing(null);
            ctl.settings.hotkeys = defaultSettings().hotkeys;
            ctl.changed();
          }}
        >
          Reset all hotkeys
        </Btn>
      </div>
    </>
  );
}

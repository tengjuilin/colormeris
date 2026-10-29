// The Settings dialog's content: header with the close button (a submit button of <form method="dialog">, so
// the browser closes the <dialog>), the section nav and the panes. The <dialog> element, showModal, the
// backdrop click and the stored settings stay in settings-dialog.ts. The panes render after the first open and
// then stay mounted (hidden when not current), so drafts survive switching tabs.
import { StrictMode, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { SettingsSource } from '../../types/index.ts';
import { SettingsProvider } from '../../ui/index.ts';
import { AgentPane } from './agent-pane.tsx';
import { ColorsPane } from './colors-pane.tsx';
import { HotkeysPane } from './hotkeys-pane.tsx';
import { MatchingPane } from './matching-pane.tsx';
import { type SettingsCtl, SettingsCtlContext } from './settings-ctl.ts';
import { TransferPane } from './transfer-pane.tsx';

const TABS: [id: string, label: string][] = [
  ['agent', 'Agent'],
  ['matching', 'Matching'],
  ['hotkeys', 'Hotkeys'],
  ['colors', 'Colors'],
  ['transfer', 'Import and export'],
];

function Pane({ id, tab, children }: { id: string; tab: string; children: React.ReactNode }) {
  return (
    <section className="settings-pane" data-settings-pane={id} hidden={tab !== id}>
      {children}
    </section>
  );
}

export function SettingsDialogUi({ ctl }: { ctl: SettingsCtl }) {
  const { tab, shown } = useSyncExternalStore(ctl.ui.subscribe, ctl.ui.get);
  return (
    <>
      <form method="dialog" className="settings-head">
        <h2 id="settings-title">Settings</h2>
        <button type="submit" className="btn ghost icon" value="close" aria-label="Close settings" title="Close (Esc)">
          ×
        </button>
      </form>
      <div className="settings-body">
        <nav className="settings-nav" aria-label="Settings sections">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? 'active' : undefined}
              data-settings-tab={id}
              onClick={() => ctl.ui.setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        {shown && (
          <>
            <Pane id="agent" tab={tab}>
              <h3>Agent</h3>
              <p className="muted small">
                Used by the <i>Agent</i> card of the heatmap tool. Settings are saved in this browser as you change
                them.
              </p>
              <AgentPane />
            </Pane>
            <Pane id="matching" tab={tab}>
              <h3>Matching</h3>
              <p className="muted small">
                How colors are matched to the colorbar. New panels start with these values; changing one here applies it
                to every panel of that tool in the open project (Undo reverts it). Panels keep their values in the
                project zip.
              </p>
              <MatchingPane />
            </Pane>
            <Pane id="hotkeys" tab={tab}>
              <h3>Hotkeys</h3>
              <p className="muted small">
                Click <i>Change</i>, then press the new key or combination. A key used by another action in the same
                tool moves to this one; ROI and Map actions may share keys, since only one tool is active at a time. Esc
                (cancel), Space (pan), Enter and Backspace (polygons) and Delete or Backspace (regions, profiles) are
                fixed. Ctrl on Windows and Linux is ⌘ on a Mac, so hotkeys (and settings files) work on both; Control
                (⌃) on a Mac and the Windows key are left to the system.
              </p>
              <HotkeysPane />
            </Pane>
            <Pane id="colors" tab={tab}>
              <h3>Colors</h3>
              <p className="muted small">
                Colors of the marks drawn over figures: corners, colorbar, regions, profiles and flags. Pick colors that
                stand out from the figure's own colormap. Masks and flag layers keep their transparency.
              </p>
              <ColorsPane />
            </Pane>
            <Pane id="transfer" tab={tab}>
              <h3>Import and export</h3>
              <p className="muted small">
                Save all settings (agent, matching, hotkeys and colors) to a zip, and load them in another browser or
                after clearing this one.
              </p>
              <TransferPane />
            </Pane>
          </>
        )}
      </div>
    </>
  );
}

/** Render the dialog's content into the (empty) <dialog>; `source` feeds useSettings. */
export function mountSettingsDialog(dialog: HTMLDialogElement, ctl: SettingsCtl, source: SettingsSource) {
  const root = createRoot(dialog);
  flushSync(() =>
    root.render(
      <StrictMode>
        <SettingsProvider source={source} mac={ctl.mac}>
          <SettingsCtlContext.Provider value={ctl}>
            <SettingsDialogUi ctl={ctl} />
          </SettingsCtlContext.Provider>
        </SettingsProvider>
      </StrictMode>,
    ),
  );
}

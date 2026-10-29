// Import and export pane of the Settings dialog: all settings as a zip, and Reset. Import keeps the current
// API key when the file has none; Reset keeps the key too.
import JSZip from 'jszip';
import { useState } from 'react';
import { Btn, Check } from '../../ui/index.ts';
import { buildSettingsZip, defaultSettings, readSettingsFile } from './settings.ts';
import { useSettingsCtl } from './settings-ctl.ts';

export function TransferPane() {
  const ctl = useSettingsCtl();
  const { ws } = ctl;
  const [includeKey, setIncludeKey] = useState(false);

  async function exportZip() {
    if (includeKey && !ctl.settings.agent.key) ws.toast('There is no API key to include.');
    const blob = await buildSettingsZip(JSZip, ctl.settings, { includeKey });
    ws.download(blob, 'colormeris-settings.zip');
  }

  async function importFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const { settings: next, hasKey } = await readSettingsFile(JSZip, file, file.name);
      const cur = ctl.settings.agent;
      if (!hasKey) next.agent = { ...next.agent, key: cur.key, rememberKey: cur.rememberKey };
      ctl.replaceAll(next);
      ws.toast(`Settings imported from ${file.name}${hasKey ? ', with an API key' : ''}.`);
    } catch (err) {
      console.error(err);
      ws.toast(`Could not import settings: ${(err as Error).message}`, true);
    }
  }

  function reset() {
    if (!confirm('Reset all settings to the defaults? The API key is kept.')) return;
    const next = defaultSettings();
    next.agent.key = ctl.settings.agent.key;
    next.agent.rememberKey = ctl.settings.agent.rememberKey;
    ctl.replaceAll(next);
    ws.toast('Settings reset.');
  }

  return (
    <>
      <fieldset>
        <legend>Export</legend>
        <Check
          small
          id="settings-include-key"
          label="Include the API key"
          checked={includeKey}
          onChange={setIncludeKey}
        />
        <p className="muted small">
          The key is stored as plain text in the zip. Anyone with the file can spend your OpenRouter credit.
        </p>
        <div className="row">
          <Btn variant="primary" id="settings-export" onClick={() => void exportZip()}>
            Export settings (.zip)
          </Btn>
        </div>
      </fieldset>
      <fieldset>
        <legend>Import</legend>
        <p className="muted small">
          Replaces the current settings. If the file has no API key, the current key is kept.
        </p>
        <div className="row">
          <label className="btn">
            Import settings…
            <input
              id="settings-import"
              type="file"
              accept=".zip,.json,application/zip,application/json"
              hidden
              onChange={(e) => void importFile(e.target)}
            />
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Reset</legend>
        <div className="row">
          <Btn variant="danger" id="settings-reset" onClick={reset}>
            Reset all settings
          </Btn>
        </div>
        <p className="muted small">Back to the defaults; the API key is kept.</p>
      </fieldset>
    </>
  );
}

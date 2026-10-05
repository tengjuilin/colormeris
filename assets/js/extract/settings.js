(function (CM) {
  'use strict';

  // App settings (pure): the agent connection, matching defaults per tool,
  // hotkeys and overlay colors. Kept in localStorage by settings-dialog.js and
  // saved to or read from a settings zip (settings.json inside). Unlike
  // project.json these belong to the user, not to a figure.

  const SETTINGS_SCHEMA = 'colormeris-settings';
  const SETTINGS_VERSION = 1;
  const SETTINGS_FILE = 'settings.json';

  // Hotkeys. A combo is a string such as "G", "Mod+Shift+Z" or "ArrowLeft";
  // Mod is Ctrl, or ⌘ on a Mac. An action can have several combos.
  // `group` is its section in the Settings dialog (HOTKEY_GROUPS). `tool`
  // limits an action to one tool, so tools may reuse each other's keys;
  // `always` also runs it before a file is open.
  const HOTKEY_GROUPS = [
    { id: 'general', label: 'General' },
    { id: 'view', label: 'View and pages' },
    { id: 'calibration', label: 'Calibration (all tools)' },
    { id: 'roi', label: 'ROI' },
    { id: 'map', label: 'Map' },
  ];
  const HOTKEY_ACTIONS = [
    { id: 'undo', group: 'general', label: 'Undo', keys: ['Mod+Z'], always: true },
    { id: 'redo', group: 'general', label: 'Redo', keys: ['Mod+Shift+Z', 'Mod+Y'], always: true },
    { id: 'fit', group: 'view', label: 'Fit to view', keys: ['F'] },
    { id: 'zoomIn', group: 'view', label: 'Zoom in', keys: ['=', '+'] },
    { id: 'zoomOut', group: 'view', label: 'Zoom out', keys: ['-'] },
    { id: 'crosshair', group: 'view', label: 'Crosshair', keys: ['C'] },
    { id: 'prevPage', group: 'view', label: 'Previous page', keys: ['ArrowLeft'] },
    { id: 'nextPage', group: 'view', label: 'Next page', keys: ['ArrowRight'] },
    { id: 'grid', group: 'calibration', label: 'Place grid or plot area corners', keys: ['G'] },
    { id: 'colorbar', group: 'calibration', label: 'Place colorbar ends', keys: ['B'] },
    { id: 'ticks', group: 'calibration', label: 'Add colorbar ticks', keys: ['T'] },
    { id: 'ellipse', group: 'roi', label: 'Ellipse region', keys: ['E'], tool: 'roi' },
    { id: 'rect', group: 'roi', label: 'Rectangle region', keys: ['R'], tool: 'roi' },
    { id: 'polygon', group: 'roi', label: 'Polygon region', keys: ['P'], tool: 'roi' },
    { id: 'xtick', group: 'map', label: 'Add x-axis ticks', keys: ['X'], tool: 'map' },
    { id: 'ytick', group: 'map', label: 'Add y-axis ticks', keys: ['Y'], tool: 'map' },
    { id: 'profile', group: 'map', label: 'Draw a line profile', keys: ['L'], tool: 'map' },
    { id: 'copyProfiles', group: 'map', label: 'Copy selected profiles', keys: ['Mod+C'], tool: 'map' },
    { id: 'pasteProfiles', group: 'map', label: 'Paste profiles', keys: ['Mod+V'], tool: 'map' },
    { id: 'sweepProfile', group: 'map', label: 'Sweep the profile across the plot', keys: ['K'], tool: 'map' },
  ];
  // Keys with a fixed meaning: cancel, pan, and finishing or editing a polygon.
  const RESERVED_KEYS = ['Escape', 'Space', 'Enter', 'Backspace', 'Delete', 'Tab'];

  const MATCHING_DEFAULTS = {
    heatmap: { distance: 'de2000', maxDeltaE: 10 },
    // IVIS photos carry JPEG color noise up to about chroma 20 (see project.js).
    roi: { distance: 'de2000', maxDeltaE: 20, grayChroma: 20 },
    map: { distance: 'de2000', maxDeltaE: 10 },
  };

  // Overlay colors drawn over figures, as #rrggbb. A palette is a list: items
  // (ROI regions, map profiles) take its colors in turn. Translucent layers
  // keep their own opacity. `group` is the section in the Settings dialog.
  const COLOR_GROUPS = [
    { id: 'common', label: 'All tools' },
    { id: 'roi', label: 'ROI' },
    { id: 'map', label: 'Map' },
  ];
  const COLOR_ITEMS = [
    { id: 'grid', group: 'common', label: 'Grid and plot area', value: '#e22bd0' },
    { id: 'bar', group: 'common', label: 'Colorbar and its ticks', value: '#f29900' },
    { id: 'flag', group: 'common', label: 'Flagged heatmap cells', value: '#ff3b30' },
    { id: 'highlight', group: 'common', label: 'Highlight (hovered cell, first polygon point)', value: '#ffd400' },
    { id: 'scale', group: 'common', label: 'Scale bar', value: '#22d3ee' },
    { id: 'roiPalette', group: 'roi', label: 'Regions', value: ['#00e5ff', '#ffd400', '#7cff4f', '#ff6ad5', '#ff8c1a', '#b18cff', '#ffffff', '#4fa3ff'] },
    { id: 'roiDraft', group: 'roi', label: 'Region being drawn', value: '#00e5ff' },
    { id: 'roiSignal', group: 'roi', label: 'Signal mask (Show signal)', value: '#ff00c8' },
    { id: 'roiFlagged', group: 'roi', label: 'Flagged pixels in the mask', value: '#ff2828' },
    { id: 'axisX', group: 'map', label: 'X-axis ticks', value: '#7cff4f' },
    { id: 'axisY', group: 'map', label: 'Y-axis ticks', value: '#ffd400' },
    { id: 'profilePalette', group: 'map', label: 'Profiles', value: ['#00c2e0', '#e040a0', '#f59f00', '#40c057', '#845ef7'] },
    { id: 'trace', group: 'map', label: 'Traced profile sample', value: '#ffd400' },
    { id: 'mapFlag', group: 'map', label: 'Flagged values (Show flags)', value: '#ff2828' },
    { id: 'mapHigh', group: 'map', label: 'At the colorbar top (Show flags)', value: '#ff00c8' },
    { id: 'mapLow', group: 'map', label: 'At the colorbar bottom (Show flags)', value: '#00e5ff' },
  ];
  const COLOR_DEFAULTS = Object.fromEntries(COLOR_ITEMS.map((c) => [c.id, structuredClone(c.value)]));

  const hexColor = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : null);

  // [r, g, b] of a #rrggbb color.
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  const AGENT_DEFAULTS = { key: '', rememberKey: false, minConfidence: 0.9, maxSteps: 80, base: '', llm: '', reviewer: '' };

  function defaultSettings() {
    return {
      agent: { ...AGENT_DEFAULTS },
      matching: structuredClone(MATCHING_DEFAULTS),
      hotkeys: Object.fromEntries(HOTKEY_ACTIONS.map((a) => [a.id, [...a.keys]])),
      colors: structuredClone(COLOR_DEFAULTS),
    };
  }

  const num = (v, lo, hi, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  const str = (v, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);

  // Settings from any JSON-ish input; missing or bad values fall back to the defaults.
  function normalizeSettings(raw) {
    const out = defaultSettings();
    if (!raw || typeof raw !== 'object') return out;
    const a = raw.agent || {};
    const d = out.agent;
    out.agent = {
      key: str(a.key),
      rememberKey: typeof a.rememberKey === 'boolean' ? a.rememberKey : d.rememberKey,
      minConfidence: num(a.minConfidence, 0, 1, d.minConfidence),
      maxSteps: Math.round(num(a.maxSteps, 5, 400, d.maxSteps)),
      base: str(a.base),
      llm: str(a.llm),
      reviewer: str(a.reviewer),
    };
    for (const [kind, defs] of Object.entries(MATCHING_DEFAULTS)) {
      const m = raw.matching?.[kind] || {};
      const t = out.matching[kind];
      t.distance = m.distance === 'de76' || m.distance === 'de2000' ? m.distance : defs.distance;
      t.maxDeltaE = num(m.maxDeltaE, 0, 1000, defs.maxDeltaE);
      if ('grayChroma' in defs) t.grayChroma = num(m.grayChroma, 0, 60, defs.grayChroma);
    }
    const hk = raw.hotkeys || {};
    for (const action of HOTKEY_ACTIONS) {
      const keys = hk[action.id];
      if (!Array.isArray(keys)) continue;
      out.hotkeys[action.id] = [...new Set(keys.map(normalizeCombo).filter(Boolean))];
    }
    const colors = raw.colors || {};
    for (const item of COLOR_ITEMS) {
      const v = colors[item.id];
      if (Array.isArray(item.value)) {
        // A palette keeps its length; bad or missing entries take the default.
        if (Array.isArray(v)) out.colors[item.id] = item.value.map((d, i) => hexColor(v[i]) ?? d);
      } else if (hexColor(v)) out.colors[item.id] = hexColor(v);
    }
    return out;
  }

  // ---------------------------------------------------------------- hotkeys

  const MODIFIERS = ['Mod', 'Alt', 'Shift'];

  // Canonical form of a combo: modifiers in a fixed order, letters upper case.
  // Returns '' for a combo that cannot be a hotkey.
  function normalizeCombo(combo) {
    if (typeof combo !== 'string') return '';
    // "Mod++" is Mod and the plus key.
    const parts = combo.trim().split(/\+(?=.)/);
    const key = parts.pop();
    const mods = new Set(parts.map((p) => ({ ctrl: 'Mod', cmd: 'Mod', meta: 'Mod', mod: 'Mod', alt: 'Alt', option: 'Alt', shift: 'Shift' })[p.toLowerCase()]));
    if (mods.has(undefined) || !key) return '';
    const k = key.length === 1 ? key.toUpperCase() : key === ' ' ? 'Space' : key;
    if (RESERVED_KEYS.includes(k) && !mods.size) return '';
    return [...MODIFIERS.filter((m) => mods.has(m)), k].join('+');
  }

  // Whether the browser runs on macOS or iOS, where ⌘ is the command key.
  // `nav` is navigator (passed in, so this stays testable).
  function isMacPlatform(nav) {
    const platform = nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || '';
    return /Mac|iPhone|iPad|iPod/i.test(platform);
  }

  // Combo of a keydown event, or '' for a key that is not a hotkey (a lone
  // modifier). Mod is ⌘ on a Mac and Ctrl elsewhere; the other key of the
  // pair (Control on a Mac, the Windows key) belongs to the system, so chords
  // with it are no hotkeys. Shift only counts for letters and named keys,
  // since for other characters it changes the character itself ("+" is
  // Shift and "=" on many keyboards).
  function comboFromEvent(e, mac = false) {
    let key = e.key;
    if (!key || ['Control', 'Meta', 'OS', 'Alt', 'AltGraph', 'Shift', 'CapsLock', 'Dead', 'Unidentified'].includes(key)) return '';
    if (mac ? e.ctrlKey : e.metaKey) return '';
    // Alt changes the character on a Mac (Alt+G types ©), and other keyboard
    // layouts type other letters (Cyrillic, Greek); take the name of letter
    // and digit keys from their position then, as on a US keyboard.
    const code = /^(?:Key([A-Z])|Digit(\d))$/.exec(e.code || '');
    if (code && (e.altKey || (key.length === 1 && !/^[\x20-\x7e]$/.test(key)))) key = code[1] || code[2];
    if (key === ' ') key = 'Space';
    const letter = /^[a-z]$/i.test(key);
    const mods = [];
    if (mac ? e.metaKey : e.ctrlKey) mods.push('Mod');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey && (letter || key.length > 1)) mods.push('Shift');
    return [...mods, key.length === 1 ? key.toUpperCase() : key].join('+');
  }

  // Whether two actions can be active at the same time, so they cannot share
  // a key: actions of different tools can.
  function hotkeysOverlap(a, b) {
    const ta = HOTKEY_ACTIONS.find((x) => x.id === a)?.tool ?? null;
    const tb = HOTKEY_ACTIONS.find((x) => x.id === b)?.tool ?? null;
    return !ta || !tb || ta === tb;
  }

  // Id of the action bound to a combo, or null. With `tool`, actions of other
  // tools are skipped; without it, the first match counts.
  function findHotkey(hotkeys, combo, tool = null) {
    if (!combo) return null;
    for (const [id, keys] of Object.entries(hotkeys || {})) {
      if (!keys.includes(combo)) continue;
      const only = HOTKEY_ACTIONS.find((a) => a.id === id)?.tool ?? null;
      if (!tool || !only || only === tool) return id;
    }
    return null;
  }

  // Ids of other actions bound to combo that would clash with action `id`.
  function hotkeyClashes(hotkeys, combo, id) {
    return Object.entries(hotkeys || {})
      .filter(([other, keys]) => other !== id && keys.includes(combo) && hotkeysOverlap(id, other))
      .map(([other]) => other);
  }

  const KEY_NAMES = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', PageUp: 'Page Up', PageDown: 'Page Down' };
  // A Mac keyboard labels some keys with symbols; its "delete" key is Backspace.
  const MAC_KEY_NAMES = { ...KEY_NAMES, Backspace: '⌫', Delete: '⌦', Enter: '↩', Escape: 'esc', Tab: '⇥' };
  // Human-readable combo: "Ctrl+Shift+Z", or "⇧⌘Z" on a Mac (Apple's
  // modifier order: ⌥ ⇧ ⌘).
  function formatCombo(combo, mac = false) {
    const parts = combo.split(/\+(?=.)/);
    const key = parts.pop();
    if (mac) return ['Alt', 'Shift', 'Mod'].filter((m) => parts.includes(m)).map((m) => ({ Mod: '⌘', Alt: '⌥', Shift: '⇧' })[m]).join('') + (MAC_KEY_NAMES[key] || key);
    return [...parts.map((m) => (m === 'Mod' ? 'Ctrl' : m)), KEY_NAMES[key] || key].join('+');
  }

  // ---------------------------------------------------------------- file

  // JSON of a settings file. The API key is only included when asked for.
  function serializeSettings(settings, { includeKey = false } = {}) {
    const s = normalizeSettings(settings);
    const agent = { ...s.agent };
    if (!includeKey) {
      delete agent.key;
      delete agent.rememberKey;
    }
    return { schema: SETTINGS_SCHEMA, version: SETTINGS_VERSION, exportedAt: new Date().toISOString(), ...s, agent };
  }

  // Settings from a settings file's JSON. `hasKey` tells whether the file
  // carried an API key; without one the caller keeps the current key.
  function parseSettings(json) {
    if (!json || typeof json !== 'object' || json.schema !== SETTINGS_SCHEMA) throw new Error('Not a Colormeris settings file.');
    if (json.version > SETTINGS_VERSION) throw new Error(`Settings version ${json.version} is newer than this app understands (${SETTINGS_VERSION}).`);
    return { settings: normalizeSettings(json), hasKey: typeof json.agent?.key === 'string' && json.agent.key.trim() !== '' };
  }

  async function buildSettingsZip(JSZip, settings, opts) {
    const zip = new JSZip();
    zip.file(SETTINGS_FILE, JSON.stringify(serializeSettings(settings, opts), null, 2));
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }

  // Reads a settings zip, or a bare settings.json.
  async function readSettingsFile(JSZip, blob, name = '') {
    let text;
    if (/\.json$/i.test(name)) text = await blob.text();
    else {
      const zip = await JSZip.loadAsync(blob);
      const entry = zip.file(SETTINGS_FILE) || zip.file(/(^|\/)settings\.json$/)[0];
      if (!entry) throw new Error(`No ${SETTINGS_FILE} in the zip.`);
      text = await entry.async('string');
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${SETTINGS_FILE} is not valid JSON.`);
    }
    return parseSettings(json);
  }

  Object.assign(CM, {
    SETTINGS_SCHEMA,
    SETTINGS_VERSION,
    SETTINGS_FILE,
    HOTKEY_GROUPS,
    HOTKEY_ACTIONS,
    RESERVED_KEYS,
    COLOR_GROUPS,
    COLOR_ITEMS,
    COLOR_DEFAULTS,
    hexToRgb,
    MATCHING_DEFAULTS,
    defaultSettings,
    normalizeSettings,
    normalizeCombo,
    isMacPlatform,
    comboFromEvent,
    findHotkey,
    hotkeyClashes,
    formatCombo,
    serializeSettings,
    parseSettings,
    buildSettingsZip,
    readSettingsFile,
  });
})((globalThis.Colormeris ??= {}));

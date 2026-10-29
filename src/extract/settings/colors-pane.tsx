// Colors pane of the Settings dialog: overlay colors, one color input per color (several for a palette), in
// fieldsets by COLOR_GROUPS. Changes redraw the figure at once; the setting is saved when the picker commits.
import { useEffect, useRef, useState } from 'react';
import type { ColorItem } from '../../types/index.ts';
import { Btn, useSettings } from '../../ui/index.ts';
import { COLOR_GROUPS, COLOR_ITEMS, defaultSettings } from './settings.ts';
import { useSettingsCtl } from './settings-ctl.ts';

// React's onChange is the input event, which fires while the picker is open; the native change event
// commits, and that one saves.
function ColorInput({
  value,
  label,
  onInput,
  onCommit,
}: {
  value: string;
  label: string;
  onInput: (color: string) => void;
  onCommit: (color: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const el = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const fire = () => {
      commit.current(node.value);
      setDraft(null);
    };
    node.addEventListener('change', fire);
    return () => node.removeEventListener('change', fire);
  }, []);
  return (
    <input
      ref={el}
      type="color"
      aria-label={label}
      value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value);
        onInput(e.target.value);
      }}
    />
  );
}

function ColorRow({ item }: { item: ColorItem }) {
  const ctl = useSettingsCtl();
  const { settings } = useSettings();
  const value = settings.colors[item.id];
  const list = Array.isArray(value) ? value : [value];
  const isDefault = JSON.stringify(value) === JSON.stringify(item.value);

  function setColor(i: number, color: string, save: boolean) {
    const current = ctl.settings.colors[item.id];
    if (Array.isArray(current)) current[i] = color;
    else ctl.settings.colors[item.id] = color;
    ctl.applyCssColors();
    // Redraws the figure; sidebar swatches (profile chips) and plots follow too.
    ctl.ws.changed({ light: true });
    if (save) ctl.changed();
  }

  return (
    <div className="color-row">
      <span className="color-name">{item.label}</span>
      <span className="color-swatches">
        {list.map((c, i) => (
          <ColorInput
            // biome-ignore lint/suspicious/noArrayIndexKey: a palette is a fixed-length list
            key={i}
            value={c}
            label={Array.isArray(value) ? `${item.label}, color ${i + 1}` : item.label}
            onInput={(color) => setColor(i, color, false)}
            onCommit={(color) => setColor(i, color, true)}
          />
        ))}
      </span>
      <Btn
        className="small"
        disabled={isDefault}
        onClick={() => {
          ctl.settings.colors[item.id] = structuredClone(item.value);
          ctl.changed();
          ctl.applyCssColors();
          ctl.ws.changed({ light: true });
        }}
      >
        Reset
      </Btn>
    </div>
  );
}

export function ColorsPane() {
  const ctl = useSettingsCtl();
  return (
    <>
      <div id="color-list" className="color-list">
        {COLOR_GROUPS.map((group) => (
          <fieldset key={group.id}>
            <legend>{group.label}</legend>
            {COLOR_ITEMS.filter((c) => c.group === group.id).map((item) => (
              <ColorRow key={item.id} item={item} />
            ))}
          </fieldset>
        ))}
      </div>
      <div className="row">
        <Btn
          className="small"
          id="colors-reset"
          onClick={() => {
            ctl.settings.colors = defaultSettings().colors;
            ctl.changed();
            ctl.applyCssColors();
            ctl.ws.changed({ light: true });
          }}
        >
          Reset all colors
        </Btn>
      </div>
    </>
  );
}

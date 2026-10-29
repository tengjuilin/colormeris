import { type KeyboardEvent, memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { cmapData } from '../core/colormap-library.ts';
import { parseHexColors } from '../core/cvd.ts';
import type { ColormapEntry, Rgb } from '../types/index.ts';
import { flushSafely } from '../ui/flush.ts';

// A text field that filters the colormaps as you type (an ARIA combobox),
// shared by Recolor (pick the new map), Compare (add maps) and the colorbar
// card (a known colormap). Empty, it lists them all in their groups. Typing
// "name_r" counts as the reversed map. Leaving it with text that names no map
// puts the text back. Controlled: `value` is the name shown when idle; while
// the field is being typed in, the typed text wins over a new `value`, and a focused field ignores `value` altogether.
// `mountMapPicker` hosts it in a plain DOM element for code that is not React.

const GROUPS: [string, string][] = [
  ['sequential', 'Sequential'],
  ['diverging', 'Diverging'],
  ['cyclic', 'Cyclic'],
  ['rainbow', 'Rainbow'],
  ['multi-sequential', 'Multi-sequential'],
  ['qualitative', 'Qualitative'],
  ['others', 'Others'],
];
const GROUP_TITLE = new Map(GROUPS);

export interface MapPickerProps {
  id: string; // unique on the page
  label: string;
  placeholder?: string;
  /** The name the field shows when idle, or null / undefined to stay empty. */
  value?: string | null;
  disabled?: boolean;
  title?: string;
  /** Called when a map is picked; `typedReversed` when the text ended in _r. */
  onChoose: (name: string, typedReversed: boolean) => void;
}

const mapByName = new Map(cmapData.maps.map((m) => [m.name, m]));
const baseColors = new Map<string, Rgb[]>(); // name -> colors, parsed once

function colorsOf(m: ColormapEntry): Rgb[] {
  let c = baseColors.get(m.name);
  if (!c) baseColors.set(m.name, (c = parseHexColors(m.colors)));
  return c;
}

// One pixel per color, stretched by CSS (same as the viewer's strips).
function paintStrip(canvas: HTMLCanvasElement, colors: Rgb[]) {
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d || typeof ImageData === 'undefined') return; // jsdom has no canvas
  const img = new ImageData(canvas.width, 1);
  colors.forEach((c, i) => img.data.set([c[0], c[1], c[2], 255], i * 4));
  ctx2d.putImageData(img, 0, 0);
}

const MiniStrip = memo(function MiniStrip({ map }: { map: ColormapEntry }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const n = Math.max(1, map.colors.length ? colorsOf(map).length : 1);
  useLayoutEffect(() => {
    if (ref.current) paintStrip(ref.current, colorsOf(map));
  }, [map]);
  return (
    <span className="cmap-mini">
      {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: a canvas is not focusable; the lint rule is a false positive */}
      <canvas
        ref={ref}
        className={map.kind === 'qualitative' ? 'cmap-paint qual' : 'cmap-paint'}
        width={n}
        height={1}
        aria-hidden="true"
      />
    </span>
  );
});

const lower = (m: ColormapEntry) => m.name.toLowerCase();

// An exact name (any case, with or without _r) counts as chosen.
function exact(text: string) {
  const q = text.trim().toLowerCase();
  const find = (n: string) => cmapData.maps.find((m) => lower(m) === n);
  return find(q) || find(q.replace(/_r$/, ''));
}

// Name matches first that start with the text, then any that contain it.
function matches(query: string): ColormapEntry[] {
  const q = query.trim().toLowerCase().replace(/_r$/, '');
  if (!q) return GROUPS.flatMap(([g]) => cmapData.maps.filter((m) => m.group === g));
  return [
    ...cmapData.maps.filter((m) => lower(m).startsWith(q)),
    ...cmapData.maps.filter((m) => !lower(m).startsWith(q) && lower(m).includes(q)),
  ];
}

export function MapPicker({ id, label, placeholder, value, disabled, title, onChoose }: MapPickerProps) {
  const listId = `${id}-maps`;
  const idle = value || '';
  const [typed, setTyped] = useState<string | null>(null); // null: show `value`
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  // While the field has the focus its text is the user's, whatever `value` becomes ...
  const heldIdle = useRef(idle);
  // ... except after the user's own pick: then the field follows `value` until they type again.
  const [followed, setFollowed] = useState(false);
  if (!focused || followed) heldIdle.current = idle;
  const shown = typed ?? (focused && !followed ? heldIdle.current : idle);

  const hits = useMemo(() => (open ? matches(query) : []), [open, query]);
  const q = query.trim();
  const activeId = open && active >= 0 && hits[active] ? `${listId}-${hits[active].name}` : undefined;

  useLayoutEffect(() => {
    if (!activeId) return;
    // jsdom has no scrollIntoView
    document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const openWith = (text: string) => {
    const list = matches(text);
    setQuery(text);
    setOpen(true);
    setActive(text.trim() ? (list.length ? 0 : -1) : list.findIndex((m) => m.name === value));
  };

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const choose = (name: string, text: string) => {
    const typedReversed = /_r$/i.test(text.trim()) && !mapByName.has(text.trim());
    close();
    setTyped(null);
    setFollowed(true);
    onChoose(name, typedReversed);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        openWith(shown === idle ? '' : shown);
        return;
      }
      const next = active + (e.key === 'ArrowDown' ? 1 : -1);
      setActive(hits.length ? Math.max(-1, Math.min(hits.length - 1, next)) : -1);
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      const m = hits[active] ?? exact(shown);
      if (m) choose(m.name, shown);
    } else if (e.key === 'Escape') {
      if (!open) return;
      e.preventDefault(); // so the detail drawer's Escape handler stays out of it
      setTyped(null);
      close();
    }
  };

  const onBlur = () => {
    setFocused(false);
    const m = shown.trim() && shown !== idle ? exact(shown) : null;
    if (m) choose(m.name, shown);
    else {
      setTyped(null);
      close();
    }
  };

  // Options are never focused: the input keeps the focus and points at the
  // active one with aria-activedescendant (the ARIA combobox pattern).
  const optionFor = (m: ColormapEntry, i: number, group: boolean) => (
    // biome-ignore lint/a11y/useFocusableInteractive: focus stays in the input (aria-activedescendant)
    <li
      key={m.name}
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a listbox of li options, as in the original picker
      role="option"
      id={`${listId}-${m.name}`}
      aria-selected={m.name === value}
      data-name={m.name}
      className={i === active ? 'active' : undefined}
      // mousedown, not click, so the input keeps the focus.
      onMouseDown={(e) => {
        e.preventDefault();
        choose(m.name, shown);
      }}
    >
      <MiniStrip map={m} />
      <span className="cmap-rc-opt-name">{m.name}</span>
      {group && <span className="cmap-rc-opt-group">{GROUP_TITLE.get(m.group) || ''}</span>}
    </li>
  );

  let rows: React.ReactNode[] = [];
  if (open && !q) {
    let i = 0;
    for (const [group, groupTitle] of GROUPS) {
      const maps = hits.filter((m) => m.group === group);
      if (!maps.length) continue;
      rows.push(
        <li key={`g-${group}`} className="cmap-rc-group" role="presentation">
          {groupTitle}
        </li>,
      );
      for (const m of maps) rows.push(optionFor(m, i++, false));
    }
  } else if (open) {
    rows = hits.map((m, i) => optionFor(m, i, true));
    if (!hits.length)
      rows.push(
        <li key="none" className="cmap-rc-none" role="presentation">
          No colormap matches
        </li>,
      );
  }

  return (
    <div className="cmap-rc-pick">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder || 'Type to search'}
        disabled={disabled}
        title={title || undefined}
        value={shown}
        onFocus={(e) => {
          setFocused(true);
          setFollowed(false);
          e.currentTarget.select();
          openWith('');
        }}
        onClick={() => {
          if (!open) openWith('');
        }}
        onChange={(e) => {
          setFollowed(false);
          setTyped(e.target.value);
          openWith(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a listbox of li options, as in the original picker */}
      <ul className="cmap-rc-maps" id={listId} role="listbox" aria-label="Colormaps" hidden={!open}>
        {rows}
      </ul>
    </div>
  );
}

export interface MountedMapPicker {
  /** Merge new props (e.g. a new `value`) and re-render. */
  update(props: Partial<MapPickerProps>): void;
  destroy(): void;
}

export function mountMapPicker(el: HTMLElement, props: MapPickerProps): MountedMapPicker {
  const root = createRoot(el);
  let current = props;
  // Synchronous like the old `input.value =`; inside a React render it falls back to a normal render.
  const draw = () => {
    if (!flushSafely(() => root.render(<MapPicker {...current} />))) root.render(<MapPicker {...current} />);
  };
  draw();
  return {
    update(next) {
      current = { ...current, ...next };
      draw();
    },
    destroy: () => root.unmount(),
  };
}

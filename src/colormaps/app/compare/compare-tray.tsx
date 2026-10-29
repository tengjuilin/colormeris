import { useLayoutEffect, useRef } from 'react';
import { cmapData } from '../../../core/colormap-library.ts';
import { comparedWith } from '../viewer-state.ts';
import { MiniStrip } from './compare-numbers.tsx';

// The tray at the bottom of the Browse tab: the maps in the comparison as
// chips with a ×, a link to the Compare tab and Clear. The viewer shows it
// only on Browse while there are maps; the host element's `hidden` is its.

export interface CompareTrayProps {
  compare: readonly string[];
  /** Each map's direction in Browse (aligned with `compare`). */
  browseRev: readonly boolean[];
  /** Maps flipped in Compare; the chips show the direction Compare shows. */
  compareFlipped: ReadonlySet<string>;
  onCompareChange: (next: readonly string[]) => void;
}

const byName = new Map(cmapData.maps.map((m) => [m.name, m]));

export function CompareTray({ compare, browseRev, compareFlipped, onCompareChange }: CompareTrayProps) {
  const chips = useRef<HTMLDivElement>(null);
  const clear = useRef<HTMLButtonElement>(null);
  const refocus = useRef<readonly string[] | null>(null); // the list a removal started from

  // Keep the keyboard in the tray after a removal: on the next chip, or on Clear (unless the tray is gone).
  useLayoutEffect(() => {
    if (!refocus.current || refocus.current === compare) return;
    refocus.current = null;
    const next = chips.current?.querySelector<HTMLElement>('.cmap-chip-x');
    if (next) next.focus();
    else if (!clear.current?.closest<HTMLElement>('.cmap-tray')?.hidden) clear.current?.focus();
  });

  return (
    <>
      <span className="cmap-tray-label">Comparing</span>
      <div className="cmap-tray-chips" ref={chips}>
        {compare.map((name, i) => {
          const map = byName.get(name);
          return (
            map && (
              <span className="cmap-chip" key={name}>
                <MiniStrip map={map} reversed={(browseRev[i] ?? false) !== compareFlipped.has(name)} />
                <code>{name}</code>
                <button
                  type="button"
                  className="cmap-chip-x"
                  aria-label={`Remove ${name} from comparison`}
                  title="Remove"
                  onClick={() => {
                    refocus.current = compare;
                    onCompareChange(comparedWith(compare, name, false));
                  }}
                >
                  ×
                </button>
              </span>
            )
          );
        })}
      </div>
      <a className="btn small primary" href="#compare">
        Open comparison
      </a>
      <button type="button" className="btn small" ref={clear} onClick={() => onCompareChange([])}>
        Clear
      </button>
    </>
  );
}

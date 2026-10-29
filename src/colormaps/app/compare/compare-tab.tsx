import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cmapData } from '../../../core/colormap-library.ts';
import type { ViewKey } from '../../../types/index.ts';
import { MapPicker } from '../../map-picker.tsx';
import { COMPARE_MAX } from '../../route.ts';
import { SvgFigure } from '../shared/svg-figure.tsx';
import { TooltipProvider, useTooltip } from '../shared/tooltip.tsx';
import { comparedMoved, comparedReordered, comparedWith } from '../viewer-state.ts';
import type { CmpSort } from './compare-model.ts';
import { type Compared, CompareNumbers } from './compare-numbers.tsx';
import { buildComparePlots } from './compare-plots.ts';
import { CompareHead, CompareRow } from './compare-rows.tsx';
import { SineSection } from './sine-section.tsx';

// The Compare tab of the colormap viewer (colormaps.html): up to 10 maps side
// by side as strips, four plots with every map on the same axes, a sortable
// table of the numbers, and every map applied to a sine-wave test image. The
// choice lives in the viewer (?compare=); this tab gets it as props and
// reports changes with onCompareChange. The view is built only while the tab
// is shown: a change made from Browse waits until it is shown again.

export interface CompareTabProps {
  /** True while the tab is shown. */
  active: boolean;
  /** The maps in the comparison, in order. */
  compare: readonly string[];
  /** Maps flipped here, on top of their direction in Browse. */
  compareFlipped: ReadonlySet<string>;
  /** Each compared map's direction in Browse (aligned with `compare`). */
  browseRev: readonly boolean[];
  /** Which view the strips show: 'all' or one view key. */
  stripView: string;
  onCompareChange: (next: readonly string[]) => void;
  onToggleFlip: (name: string) => void;
}

const byName = new Map(cmapData.maps.map((m) => [m.name, m]));
const FULL_TITLE = `Up to ${COMPARE_MAX} maps can be compared`;

// Where focus goes after the comparison changes from `from`; the request waits for that render.
type Focus = { from: readonly string[]; to: { name: string; act: string } | 'count' };

export function CompareTab(props: CompareTabProps) {
  // Nothing is built until the tab is first shown, and a change while it is
  // hidden waits: the latest props from the last time it was shown are used.
  const shown = useRef<CompareTabProps | null>(null);
  if (props.active && !sameInputs(shown.current, props)) shown.current = props;
  const p = shown.current;
  return <TooltipProvider tab={props.active ? 'compare' : ''}>{p && <CompareView {...p} />}</TooltipProvider>;
}

// Everything but `active`: the view needs no render when only the tab was shown again.
function sameInputs(a: CompareTabProps | null, b: CompareTabProps) {
  return (
    !!a &&
    a.compare === b.compare &&
    a.compareFlipped === b.compareFlipped &&
    a.browseRev === b.browseRev &&
    a.stripView === b.stripView &&
    a.onCompareChange === b.onCompareChange &&
    a.onToggleFlip === b.onToggleFlip
  );
}

const CompareView = memo(function CompareView({
  compare,
  compareFlipped,
  browseRev,
  stripView,
  onCompareChange,
  onToggleFlip,
}: CompareTabProps) {
  const tip = useTooltip();
  const [sort, setSort] = useState<CmpSort | null>(null); // null = selection order
  const [allCols, setAllCols] = useState(false); // only the key columns until asked
  const [pattern, setPattern] = useState('waves');
  const [view, setView] = useState<ViewKey>('orig');
  const [copyLabel, setCopyLabel] = useState('Copy link');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focus = useRef<Focus | null>(null);
  const countRef = useRef<HTMLHeadingElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const list = useMemo<Compared[]>(
    () =>
      compare.flatMap((name, i) => {
        const map = byName.get(name);
        return map ? [{ map, reversed: (browseRev[i] ?? false) !== compareFlipped.has(name) }] : [];
      }),
    [compare, compareFlipped, browseRev],
  );
  const full = list.length >= COMPARE_MAX;

  useEffect(() => () => clearTimeout(copyTimer.current), []);
  // The page tooltip must not hang over rows that are gone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `list` is the trigger, not an input
  useEffect(() => tip.hideTip(), [tip, list]);

  // Rows move or go, so the button that was focused may be gone: focus it again, or the heading.
  useLayoutEffect(() => {
    const f = focus.current;
    if (!f || f.from === compare) return;
    focus.current = null;
    const target =
      f.to !== 'count' &&
      bodyRef.current?.querySelector<HTMLElement>(
        `button[data-act="${f.to.act}"][data-name="${CSS.escape(f.to.name)}"]`,
      );
    (target || countRef.current)?.focus();
  });

  // Row handlers keep their identity (the rows are memoized) and read the latest list through refs.
  const latest = useRef({ compare, onCompareChange });
  latest.current = { compare, onCompareChange };
  const change = useCallback((next: readonly string[], to: Focus['to'] | null = null) => {
    const { compare: cur, onCompareChange: apply } = latest.current;
    if (next === cur) return;
    focus.current = to && { from: cur, to };
    apply(next);
  }, []);
  const move = useCallback(
    (name: string, d: number) => change(comparedMoved(latest.current.compare, name, d), { name, act: 'drag' }),
    [change],
  );
  const reorder = useCallback(
    (from: number, to: number) =>
      change(comparedReordered(latest.current.compare, from, to), { name: latest.current.compare[from], act: 'drag' }),
    [change],
  );
  const remove = useCallback(
    (name: string) => {
      const cur = latest.current.compare;
      const i = cur.indexOf(name);
      const next = comparedWith(cur, name, false);
      // Focus goes to the map that takes its place, or to the heading when none is left.
      change(next, next.length ? { name: next[Math.min(i, next.length - 1)], act: 'remove' } : 'count');
    },
    [change],
  );

  const copyLink = async () => {
    let msg = 'Copied';
    try {
      await navigator.clipboard.writeText(location.href);
    } catch (err) {
      console.warn('Could not copy', err);
      msg = 'Copy failed';
    }
    setCopyLabel(msg);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyLabel('Copy link'), 1500);
  };

  const plots = useCallback(() => buildComparePlots(list, tip), [list, tip]);

  return (
    <>
      <div className="cmap-compare-head">
        <h2 id="cmap-compare-count" tabIndex={-1} ref={countRef}>
          {list.length ? `Comparing ${list.length} of up to ${COMPARE_MAX}` : 'Compare'}
        </h2>
        <button type="button" className="btn small" disabled={!list.length} onClick={() => change([])}>
          Clear
        </button>
        <button type="button" className="btn small" disabled={!list.length} onClick={copyLink}>
          {copyLabel}
        </button>
      </div>
      <div className="cmap-compare-add">
        <div>
          <MapPicker
            id="cmap-cmp"
            label="Add a colormap"
            placeholder="Add a colormap: type to search"
            disabled={full}
            title={full ? FULL_TITLE : ''}
            onChoose={(name) => change(comparedWith(compare, name, true))}
          />
        </div>
      </div>
      <p className="muted" hidden={list.length > 0}>
        No colormaps chosen yet. In <a href="#browse">Browse</a>, press + on a row to add it (up to 10).
      </p>
      <div className="cmap-compare-body" ref={bodyRef} hidden={!list.length}>
        {list.length > 0 && (
          <>
            <h3>Colormaps</h3>
            <div>
              <div className="cmap-compare-rows" ref={rowsRef}>
                <CompareHead stripView={stripView} />
                {list.map((c, i) => (
                  <CompareRow
                    key={c.map.name}
                    map={c.map}
                    index={i}
                    reversed={c.reversed}
                    stripView={stripView}
                    boxRef={rowsRef}
                    onMove={move}
                    onReorder={reorder}
                    onFlip={onToggleFlip}
                    onRemove={remove}
                  />
                ))}
              </div>
            </div>
            <h3>Profiles</h3>
            <div>
              <SvgFigure build={plots} />
            </div>
            <CompareNumbers list={list} sort={sort} allCols={allCols} onSort={setSort} onAllCols={setAllCols} />
            <SineSection list={list} pattern={pattern} view={view} onPattern={setPattern} onView={setView} />
          </>
        )}
      </div>
    </>
  );
});

import { type Dispatch, memo, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { ColormapEntry, ViewKey } from '../../../types/index.ts';
import { GLYPH, VIEWS } from '../../common.ts';
import { notesOf, viewData } from '../../library-cache.ts';
import { CMAP_REFS, citeFor } from '../../references.ts';
import { COMPARE_MAX } from '../../route.ts';
import { REF_NUMBERS } from '../ref-numbers.ts';
import { ProbeStrip } from '../shared/probe-strip.tsx';
import { useTooltip } from '../shared/tooltip.tsx';
import type { ViewerAction } from '../viewer-state.ts';
import { useDetailFolds } from './detail-folds.ts';
import { StatsList, ViewTable, Zones } from './detail-numbers.tsx';
import { DetailPlots } from './detail-plots.tsx';

// The detail view of one colormap (colormaps.html): the name with Expand all,
// the comparison button and Close, the map in all five views, the rating
// sentences, the four plots, and three folds (numbers, where values get
// confused, references). It sits in the drawer on wide screens and under the
// map's row otherwise; the two places render this same component. The folds
// the user opened are remembered by useDetailFolds, so they survive another
// map being opened and a move between the two places.

// The map whose name was last focused. The detail is created anew when it
// moves between the drawer and the list; that must not steal focus again.
let lastFocused: string | null = null;
let mounted = 0;

const FOLD_IDS = ['views', 'zones', 'refs'] as const;
type FoldId = (typeof FOLD_IDS)[number];

export interface DetailBodyProps {
  map: ColormapEntry;
  reversed: boolean;
  /** The map is in the comparison. */
  compared: boolean;
  /** The comparison is at COMPARE_MAX maps. */
  compareFull: boolean;
  onClose: () => void;
  dispatch: Dispatch<ViewerAction>;
}

function Fold({
  id,
  title,
  open,
  onFold,
  children,
}: {
  id: FoldId;
  title: string;
  open: boolean;
  onFold: (id: FoldId, open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details className="cmap-fold" open={open} onToggle={(e) => onFold(id, e.currentTarget.open)}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

function DetailRef({ k }: { k: string }) {
  const ref = CMAP_REFS[k];
  return (
    // Copies have no id, so the footer keeps the anchors.
    <li value={REF_NUMBERS.get(k) ?? REF_NUMBERS.size + 1}>
      {ref.text}
      {ref.url && (
        <>
          {' '}
          {/* biome-ignore lint/a11y/noAmbiguousAnchorText: the footer's reference links read the same */}
          <a href={ref.url} target="_blank" rel="noopener">
            Link
          </a>
        </>
      )}
    </li>
  );
}

export const DetailBody = memo(function DetailBody({
  map,
  reversed,
  compared,
  compareFull,
  onClose,
  dispatch,
}: DetailBodyProps) {
  const qual = map.kind === 'qualitative';
  const tip = useTooltip();
  const folds = useDetailFolds();
  const title = useRef<HTMLHeadingElement>(null);
  const [pair, setPair] = useState<{ view: ViewKey; ts: number[] } | null>(null);
  const [open, setOpen] = useState<ReadonlySet<FoldId>>(() => new Set(FOLD_IDS.filter((id) => folds.has(id))));

  // Focus the name when a map is opened (not on later renders or a move), and drop a tooltip left over from it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `map.name` is the trigger, not an input
  useEffect(() => {
    mounted++;
    if (lastFocused !== map.name) {
      lastFocused = map.name;
      title.current?.focus({ preventScroll: true });
    }
    setPair(null);
    return () => {
      tip.hideTip();
      mounted--;
      // Closed (not moved or replaced): the same map may take focus again.
      queueMicrotask(() => {
        if (mounted === 0) lastFocused = null;
      });
    };
  }, [map.name, tip]);

  const setFold = useCallback(
    (id: FoldId, on: boolean) => {
      folds.set(id, on);
      setOpen((prev) => {
        if (prev.has(id) === on) return prev;
        const next = new Set(prev);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    [folds],
  );
  const onPair = useCallback((view: ViewKey, ts: number[] | null) => setPair(ts ? { view, ts } : null), []);

  const keys = citeFor(map.name);
  const shown: FoldId[] = ['views', ...(qual ? [] : (['zones'] as const)), ...(keys.length ? (['refs'] as const) : [])];
  const all = shown.every((id) => open.has(id));
  const toggleAll = () => {
    for (const id of shown) folds.set(id, !all);
    setOpen((prev) => {
      const next = new Set(prev);
      for (const id of shown) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="cmap-detail">
      <div className="cmap-detail-head">
        <h2 tabIndex={-1} ref={title}>
          <code>{map.name}</code>
        </h2>
        <button type="button" className="btn small subtle" aria-expanded={all} onClick={toggleAll}>
          {all ? 'Collapse all' : 'Expand all'}
        </button>
        <button
          type="button"
          className="btn small"
          aria-pressed={compared}
          disabled={!compared && compareFull}
          title={
            !compared && compareFull
              ? `Up to ${COMPARE_MAX} maps can be compared`
              : compared
                ? 'Remove from the comparison'
                : 'Add to the comparison'
          }
          onClick={() => dispatch({ type: 'SET_COMPARED', name: map.name, on: !compared })}
        >
          {compared ? 'In comparison ✓' : 'Add to comparison'}
        </button>
        <button type="button" className="cmap-toggle" aria-label="Close details" title="Close (Esc)" onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* All five views, whatever the list shows; the table below marks pairs on them. */}
      <div className="cmap-detail-strips">
        {VIEWS.map((v) => (
          <PairedStrip
            key={v.key}
            map={map}
            view={v.key}
            reversed={reversed}
            ts={pair?.view === v.key ? pair.ts : null}
          />
        ))}
      </div>

      <ul className="cmap-notes">
        {notesOf(map).map((n) => (
          <li key={n.key}>
            <span className={`cmap-pill ${n.rating}`}>
              <span className="cmap-glyph" aria-hidden="true">
                {GLYPH[n.rating]}
              </span>
              {n.label}
              <span className="sr-only">{`: ${n.rating}.`}</span>
            </span>
            <span>{n.text}</span>
          </li>
        ))}
        {qual && (
          <li className="muted">
            Qualitative maps are not rated for uniformity or readability, since their colors have no order.
          </li>
        )}
      </ul>

      <DetailPlots map={map} reversed={reversed} />

      <Fold id="views" title="Numbers: lightness and per view" open={open.has('views')} onFold={setFold}>
        <StatsList map={map} reversed={reversed} />
        <ViewTable map={map} reversed={reversed} onPair={onPair} />
      </Fold>
      {!qual && (
        <Fold id="zones" title="Where values get confused" open={open.has('zones')} onFold={setFold}>
          <Zones key={map.name} map={map} reversed={reversed} />
        </Fold>
      )}
      {keys.length > 0 && (
        <Fold id="refs" title="References" open={open.has('refs')} onFold={setFold}>
          <ol className="cmap-detail-refs">
            {keys.map((k) => (
              <DetailRef key={k} k={k} />
            ))}
          </ol>
        </Fold>
      )}
    </div>
  );
});

// One view's label and probe strip; `ts` are the two confused positions to mark on it.
function PairedStrip({
  map,
  view,
  reversed,
  ts,
}: {
  map: ColormapEntry;
  view: ViewKey;
  reversed: boolean;
  ts: number[] | null;
}) {
  const label = VIEWS.find((v) => v.key === view)!.label;
  const qual = map.kind === 'qualitative';
  const n = ts ? viewData(map, view, reversed).colors.length : 0;
  return (
    <>
      <span className="cmap-cap-side">{label}</span>
      <ProbeStrip map={map} view={view} reversed={reversed}>
        {ts?.map((t) => (
          <div
            key={t}
            className="cmap-marker cmap-pair"
            style={{ left: `${Math.min(((qual ? (t + 0.5) / n : t) as number) * 100, 99.6)}%` }}
          />
        ))}
      </ProbeStrip>
    </>
  );
}

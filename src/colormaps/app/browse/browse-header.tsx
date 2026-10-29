import { memo, useRef } from 'react';
import { RATING_COLS, VIEWS } from '../../common.ts';
import { MethodList } from '../footer.tsx';
import { useAnchorPopover } from '../shared/use-anchor-popover.ts';
import { useDispatch } from '../viewer-context.ts';
import type { SortState } from '../viewer-state.ts';

// The column names above the list. The Name and rating columns are buttons
// that sort (best first, then worst first, then the default order), and the
// "?" explains how the ratings are made in a native popover.

function SortButton({
  sortKey,
  sort,
  title,
  children,
}: {
  sortKey: string;
  sort: SortState | null;
  title: string;
  children: string;
}) {
  const dispatch = useDispatch();
  const on = sort?.key === sortKey;
  return (
    <button
      type="button"
      className="cmap-th"
      data-sort={sortKey}
      data-dir={on ? (sort.dir > 0 ? 'first' : 'last') : undefined}
      aria-pressed={on}
      title={title}
      onClick={() => dispatch({ type: 'SORT', key: sortKey })}
    >
      {children}
    </button>
  );
}

export const BrowseHeader = memo(function BrowseHeader({
  hidden,
  sort,
  stripView,
}: {
  hidden: boolean;
  sort: SortState | null;
  stripView: string;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useAnchorPopover(btn, pop);
  return (
    <div className="cmap-head" hidden={hidden}>
      <SortButton sortKey="name" sort={sort} title="Sort by name">
        Name
      </SortButton>
      {VIEWS.map((v) => (
        <span key={v.key} data-view={v.key} hidden={stripView !== 'all' && v.key !== stripView}>
          {v.label}
        </span>
      ))}
      {RATING_COLS.map((c) => (
        <span key={c.key} className="cmap-head-rc" title={c.label}>
          <SortButton sortKey={c.sort} sort={sort} title={`${c.label}: best first, then worst first`}>
            {c.abbr}
          </SortButton>
        </span>
      ))}
      <span className="cmap-head-end">
        <button
          type="button"
          ref={btn}
          className="cmap-help"
          aria-label="How the ratings work"
          title="How the ratings work"
          aria-expanded="false"
        >
          ?
        </button>
        <div id="cmap-pop-method" popover="" className="cmap-pop cmap-pop-wide" ref={pop}>
          <div className="cmap-pop-title">How the ratings work</div>
          <p>
            Yes (✓), partly (~) or no (✕). Rules of thumb tuned on the matplotlib maps, not standards. Hover a glyph for
            the numbers.
          </p>
          <MethodList />
          <p className="muted">
            {/* biome-ignore lint/a11y/useValidAnchor: it is a real link (to the footer); the click only closes the popover first */}
            <a href="#cmap-about" onClick={() => pop.current?.hidePopover?.()}>
              Methods and references
            </a>
          </p>
        </div>
      </span>
    </div>
  );
});

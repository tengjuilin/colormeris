import { memo, useEffect, useRef } from 'react';
import { cmapData } from '../../../core/colormap-library.ts';
import { VIEWS } from '../../common.ts';
import { useAnchorPopover } from '../shared/use-anchor-popover.ts';
import { useDispatch } from '../viewer-context.ts';
import type { Filters, SortState } from '../viewer-state.ts';
import { FILTERS, familyState, filterCount, SORTS } from './browse-model.ts';

// The bar above the list: search, which strips to show, the Filters popover
// (ratings and sources), Expand / Collapse all and the "more" popover
// (Reversed, Sort). Everything is controlled by the viewer's state; the
// popovers are native (popover="auto"), placed under their buttons by
// useAnchorPopover.

interface SourceGroup {
  /** '' for the sources without a family. */
  family: string;
  total: number;
  sources: { key: string; label: string; n: number }[];
}

// Ratings in one row, sources in columns: Python packages, other sources, R packages.
// A family is one checkbox that ticks its members, listed under it.
function sourceGroups(): SourceGroup[] {
  const groups: SourceGroup[] = [];
  for (const src of cmapData.sources) {
    const n = cmapData.maps.filter((m) => m.source === src.key).length;
    if (!n) continue;
    const family = src.family ?? '';
    let g = groups.find((x) => x.family === family);
    if (!g) {
      const total = family
        ? cmapData.maps.filter((m) => cmapData.sources.find((x) => x.key === m.source)?.family === family).length
        : 0;
      g = { family, total, sources: [] };
      groups.push(g);
    }
    g.sources.push({ key: src.key, label: src.label, n });
  }
  return groups;
}

const GROUPS = sourceGroups();

export interface BrowseControlsProps {
  hidden: boolean;
  query: string;
  stripView: string;
  filters: Filters;
  reversed: boolean;
  sort: SortState | null;
  /** 'Expand all' or 'Collapse all': what a click would do. */
  foldLabel: string;
  onFoldAll: () => void;
}

function FamilyBox({
  keys,
  ticked,
  family,
  total,
  onChange,
}: {
  keys: string[];
  ticked: readonly string[];
  family: string;
  total: number;
  onChange: (on: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const { checked, indeterminate } = familyState(ticked, keys);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className="check" title={`Only colormaps from ${family}`}>
      <input ref={ref} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {`${family} (${total})`}
    </label>
  );
}

export const BrowseControls = memo(function BrowseControls({
  hidden,
  query,
  stripView,
  filters,
  reversed,
  sort,
  foldLabel,
  onFoldAll,
}: BrowseControlsProps) {
  const dispatch = useDispatch();
  const filtBtn = useRef<HTMLButtonElement>(null);
  const filtPop = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const morePop = useRef<HTMLDivElement>(null);
  useAnchorPopover(filtBtn, filtPop);
  useAnchorPopover(moreBtn, morePop);
  const nOn = filterCount(filters, cmapData.sources);

  const setSource = (key: string, on: boolean) => dispatch({ type: 'TOGGLE_FILTER', kind: 'sources', key, on });
  return (
    <div className="cmap-controls" hidden={hidden}>
      <input
        type="search"
        placeholder="Search colormaps…"
        aria-label="Search colormaps"
        className="cmap-search"
        value={query}
        onChange={(e) => dispatch({ type: 'SET_QUERY', query: e.target.value })}
      />
      <div className="cmap-viewsel">
        <span className="muted">Views</span>
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would change the markup and its styles */}
        <div className="cmap-tabs" role="group" aria-label="Strips to show">
          {[['all', 'All 5'], ...VIEWS.map((v) => [v.key, v.short])].map(([k, t]) => (
            <button
              key={k}
              type="button"
              data-view-key={k}
              title={k === 'all' ? 'Show all five views' : `Show only ${VIEWS.find((v) => v.key === k)?.label}`}
              aria-pressed={stripView === k}
              onClick={() => dispatch({ type: 'SET_STRIP_VIEW', view: k })}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <button type="button" ref={filtBtn} className={nOn > 0 ? 'btn small active' : 'btn small'} aria-expanded="false">
        {nOn ? `Filters (${nOn})` : 'Filters'}
      </button>
      <button
        type="button"
        ref={moreBtn}
        className="btn small"
        aria-label="More options"
        title="More options"
        aria-expanded="false"
      >
        ⋯
      </button>
      <button type="button" className="btn small" onClick={onFoldAll}>
        {foldLabel}
      </button>
      <div id="cmap-pop-filters" popover="" className="cmap-pop" ref={filtPop}>
        <div className="cmap-pop-title">Only maps rated yes for</div>
        <div className="cmap-filter-ratings">
          {FILTERS.map(([id, label, tip]) => (
            <label key={id} className="check" title={tip}>
              <input
                type="checkbox"
                checked={filters.ratings.includes(id)}
                onChange={(e) => dispatch({ type: 'TOGGLE_FILTER', kind: 'ratings', key: id, on: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
        <div className="cmap-pop-title">Only maps from</div>
        <div className="cmap-filter-sources">
          {GROUPS.map((g) => {
            const keys = g.sources.map((s) => s.key);
            return (
              <div key={g.family} className="cmap-filter-group">
                {g.family ? (
                  <FamilyBox
                    keys={keys}
                    ticked={filters.sources}
                    family={g.family}
                    total={g.total}
                    onChange={(on) => {
                      for (const key of keys) setSource(key, on);
                    }}
                  />
                ) : (
                  <div className="cmap-filter-name">Other sources</div>
                )}
                <div className="cmap-filter-list">
                  {g.sources.map((s) => (
                    <label key={s.key} className="check" title={`Only colormaps from ${s.label}`}>
                      <input
                        type="checkbox"
                        checked={filters.sources.includes(s.key)}
                        onChange={(e) => setSource(s.key, e.target.checked)}
                      />
                      {`${s.label} (${s.n})`}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="cmap-pop-row">
          <button
            type="button"
            className="btn small"
            title="Tick all four ratings; the sources stay as they are"
            onClick={() => {
              for (const [id] of FILTERS) dispatch({ type: 'TOGGLE_FILTER', kind: 'ratings', key: id, on: true });
            }}
          >
            All ratings ✓
          </button>
          <button type="button" className="btn small" onClick={() => dispatch({ type: 'CLEAR_FILTERS' })}>
            Clear
          </button>
        </div>
      </div>
      <div id="cmap-pop-more" popover="" className="cmap-pop" ref={morePop}>
        <label className="check">
          <input
            type="checkbox"
            checked={reversed}
            onChange={(e) => dispatch({ type: 'SET_REVERSED', on: e.target.checked })}
          />
          Reversed
        </label>
        <label className="cmap-sort">
          <span className="muted">Sort</span>
          <select
            aria-label="Sort colormaps"
            value={sort ? sort.key : 'default'}
            onChange={(e) => dispatch({ type: 'SET_SORT', key: e.target.value })}
          >
            {SORTS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
});

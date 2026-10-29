import { memo, type Ref, useCallback, useMemo, useRef, useState } from 'react';
import { cmapData } from '../../../core/colormap-library.ts';
import { COMPARE_MAX } from '../../route.ts';
import { StickyTop } from '../sticky-top.tsx';
import { TabNav } from '../tab-nav.tsx';
import { useDispatch } from '../viewer-context.ts';
import { type Filters, filtering as isFiltering, type SortState, type ViewerState } from '../viewer-state.ts';
import { BrowseControls } from './browse-controls.tsx';
import { BrowseHeader } from './browse-header.tsx';
import { BrowseList, subKey } from './browse-list.tsx';
import { buildTree, isShown, sortNames } from './browse-model.ts';
import { type RowProps, type RowView, RowViewContext } from './row.tsx';
import type { FoldCmd } from './section.tsx';

// The Browse tab, and the sticky bar above it: the tab links, the controls and
// the column names are in one sticky box (they share it so they stay readable
// while scrolling), the list follows. This component turns the viewer's state
// into what the pieces need: the sections and their order (sorted once per
// sort), the names the search and filters show (once per query and filter),
// and one primitive-only props object per row. Pieces are memoised, so a
// sort moves rows without rendering any, and a tab switch only flips `hidden`.

const MAPS = cmapData.maps;
const TREE = buildTree(MAPS);
// Position in the default list (sections, sub-headings, maps): numbers the panels' ids.
const INDEX = new Map<string, number>(TREE.flatMap((sec) => sec.subs.flatMap((s) => s.names)).map((n, i) => [n, i]));

export interface BrowseTabProps {
  tab: string;
  open: string | null;
  compare: readonly string[];
  reversed: boolean;
  flipped: ReadonlySet<string>;
  stripView: string;
  sort: SortState | null;
  query: string;
  filters: Filters;
  reveal: ViewerState['reveal'];
  /** The wide layout: the open detail is in the drawer, not under its row. */
  wide: boolean;
  /** The sticky bar's element, for the scroll anchor. */
  topRef: Ref<HTMLDivElement>;
}

export const BrowseTab = memo(function BrowseTab(p: BrowseTabProps) {
  const dispatch = useDispatch();
  const { tab, open, compare, reversed, flipped, stripView, sort, query, filters, reveal, wide } = p;
  const browsing = tab === 'browse';
  const filteringOn = isFiltering({ query, filters });

  const order = useMemo(
    () =>
      new Map(TREE.flatMap((sec) => sec.subs.map((s) => [subKey(sec.group, s.sub), sortNames(s.names, sort, MAPS)]))),
    [sort],
  );
  const shown = useMemo(
    () => (filteringOn ? new Set(MAPS.filter((m) => isShown(m, query, filters)).map((m) => m.name)) : null),
    [filteringOn, query, filters],
  );
  const comparedSet = useMemo(() => new Set(compare), [compare]);
  const compareFull = compare.length >= COMPARE_MAX;

  const rowProps = useCallback(
    (name: string): RowProps => {
      const isOpen = open === name;
      return {
        name,
        index: INDEX.get(name) ?? 0,
        compared: comparedSet.has(name),
        open: isOpen,
        inline: isOpen && !wide,
        forceBuild: reveal?.name === name ? reveal.n : 0,
        dispatch,
      };
    },
    [open, comparedSet, wide, reveal, dispatch],
  );
  const view = useMemo<RowView>(
    () => ({ reversed, flipped, stripView, compareFull }),
    [reversed, flipped, stripView, compareFull],
  );

  // Expand all / Collapse all: the label follows the DOM (the folds are uncontrolled).
  const [foldLabel, setFoldLabel] = useState('Expand all');
  const [foldCmd, setFoldCmd] = useState<FoldCmd | null>(null);
  const labelRef = useRef(foldLabel);
  labelRef.current = foldLabel;
  const onFoldAll = useCallback(
    () => setFoldCmd((c) => ({ open: labelRef.current === 'Expand all', n: (c?.n ?? 0) + 1 })),
    [],
  );

  return (
    <>
      <StickyTop ref={p.topRef}>
        <TabNav tab={tab} compareCount={compare.length} />
        <BrowseControls
          hidden={!browsing}
          query={query}
          stripView={stripView}
          filters={filters}
          reversed={reversed}
          sort={sort}
          foldLabel={foldLabel}
          onFoldAll={onFoldAll}
        />
        <BrowseHeader hidden={!browsing} sort={sort} stripView={stripView} />
      </StickyTop>
      <RowViewContext.Provider value={view}>
        <BrowseList
          hidden={!browsing}
          tree={TREE}
          order={order}
          shown={shown}
          filtering={filteringOn}
          rowProps={rowProps}
          foldCmd={foldCmd}
          onFoldsChanged={setFoldLabel}
        />
      </RowViewContext.Provider>
    </>
  );
});

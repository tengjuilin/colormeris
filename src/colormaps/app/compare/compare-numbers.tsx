import { useMemo } from 'react';
import type { ColormapEntry } from '../../../types/index.ts';
import { viewData } from '../../library-cache.ts';
import { RatingPills } from '../shared/rating.tsx';
import { Strip } from '../shared/strip.tsx';
import {
  bestByColumn,
  type CmpSort,
  cycleCmpSort,
  facts,
  groupRuns,
  isBest,
  sortFacts,
  visibleCols,
} from './compare-model.ts';

// The "Numbers" part of the Compare tab: a sortable table with one row per
// compared map and the best value of each column marked. The sort and the
// column set belong to the tab (they stay when the list is empty), so they
// come in as props.

export interface Compared {
  map: ColormapEntry;
  reversed: boolean;
}

export function MiniStrip({ map, reversed }: Compared) {
  return (
    <span className="cmap-mini">
      <Strip colors={viewData(map, 'orig', reversed).colors} qualitative={map.kind === 'qualitative'} />
    </span>
  );
}

export interface CompareNumbersProps {
  list: Compared[];
  sort: CmpSort | null;
  allCols: boolean;
  onSort: (sort: CmpSort | null) => void;
  onAllCols: (on: boolean) => void;
}

export function CompareNumbers({ list, sort, allCols, onSort, onAllCols }: CompareNumbersProps) {
  const cols = visibleCols(allCols);
  const rows = useMemo(() => list.map((c) => ({ ...c, facts: facts(c.map) })), [list]);
  const ordered = useMemo(() => {
    const byMap = new Map(rows.map((r) => [r.map.name, r]));
    return sortFacts(
      rows.map((r) => r.facts),
      sort,
    ).map((f) => byMap.get(f.map.name)!);
  }, [rows, sort]);
  const best = bestByColumn(
    cols,
    ordered.map((r) => r.facts),
  );

  return (
    <>
      <div className="cmap-nums-head">
        <h3>Numbers</h3>
        <button
          type="button"
          className={allCols ? 'btn small active' : 'btn small'}
          aria-pressed={allCols}
          onClick={() => onAllCols(!allCols)}
        >
          All numbers
        </button>
      </div>
      <div>
        <div className="cmap-table-wrap">
          <table className="cmap-nums">
            <thead>
              <tr className="cmap-groups">
                {groupRuns(cols).map(([group, span], i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: runs have no identity of their own
                  <th key={i} scope="colgroup" colSpan={span}>
                    {group}
                  </th>
                ))}
              </tr>
              <tr>
                {cols.map((c) => (
                  <th
                    key={c.id}
                    scope="col"
                    data-col={c.id}
                    title={c.hint && c.noSort ? c.hint : undefined}
                    aria-sort={
                      c.noSort ? undefined : sort?.id === c.id ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'
                    }
                  >
                    {c.noSort ? (
                      c.label
                    ) : (
                      <button
                        type="button"
                        className="cmap-th"
                        title={`${c.hint ? `${c.hint} ` : ''}Click to sort.`}
                        onClick={() => onSort(cycleCmpSort(sort, c.id))}
                      >
                        {c.label}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordered.map((r) => (
                <tr key={r.map.name}>
                  <th scope="row">
                    <code>{r.map.name}</code>
                    <MiniStrip map={r.map} reversed={r.reversed} />
                  </th>
                  {cols.slice(1).map((c) =>
                    c.id === 'rating' ? (
                      <td key={c.id}>
                        <RatingPills map={r.map} />
                      </td>
                    ) : isBest(c, r.facts, best) ? (
                      <td key={c.id} className="best" title="Best in this column">
                        {c.show?.(r.facts)}
                        <span className="sr-only"> (best)</span>
                      </td>
                    ) : (
                      <td key={c.id}>{c.show?.(r.facts)}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

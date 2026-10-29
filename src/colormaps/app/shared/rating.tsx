import { memo } from 'react';
import type { ColormapEntry } from '../../../types/index.ts';
import { GLYPH, PILL, RATING_COLS } from '../../common.ts';
import { notesOf } from '../../library-cache.ts';

// The rating marks of a map, with the markup of viewer.ts ratingPills / ratingCells.

/** Pills under the name: on phones in the list, and in the comparison table. */
export const RatingPills = memo(function RatingPills({ map }: { map: ColormapEntry }) {
  return (
    <div className="cmap-badges">
      {notesOf(map).map((n) => (
        <span key={n.key} className={`cmap-pill ${n.rating}`} title={`${n.label}: ${n.rating}. ${n.text}`}>
          <span className="cmap-glyph" aria-hidden="true">
            {GLYPH[n.rating]}
          </span>
          {PILL[n.key]}
          <span className="sr-only">{`: ${n.rating}`}</span>
        </span>
      ))}
    </div>
  );
});

/** One glyph per rating column, so ratings can be scanned down the list. */
export const RatingCells = memo(function RatingCells({ map }: { map: ColormapEntry }) {
  const notes = notesOf(map);
  return (
    <>
      {RATING_COLS.map((c) => {
        const n = notes.find((x) => x.key === c.key);
        if (!n)
          return (
            <span key={c.key} className="cmap-rc na" title={`${c.label}: does not apply to qualitative maps`}>
              —
            </span>
          );
        return (
          <span key={c.key} className={`cmap-rc ${n.rating}`} title={`${c.label}: ${n.rating}. ${n.text}`}>
            <span aria-hidden="true">{GLYPH[n.rating]}</span>
            <span className="sr-only">{`${c.label}: ${n.rating}`}</span>
          </span>
        );
      })}
    </>
  );
});

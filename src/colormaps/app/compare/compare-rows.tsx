import { memo, type PointerEvent, useRef } from 'react';
import type { ColormapEntry } from '../../../types/index.ts';
import { RATING_COLS, VIEWS } from '../../common.ts';
import { ProbeStrip } from '../shared/probe-strip.tsx';
import { RatingCells, RatingPills } from '../shared/rating.tsx';
import { startRowDrag } from './drag-reorder.ts';

// The strips of the compared maps, one row each: the five views, the rating
// glyphs and the buttons (drag to reorder, reverse, remove). Same markup as
// the Browse list, whose column names are repeated above. The drag itself is
// imperative (drag-reorder.ts); the order changes on release.

const GRIP = 'M6 3.5v.01M10 3.5v.01M6 8v.01M10 8v.01M6 12.5v.01M10 12.5v.01';
const FLIP = 'M3 6h9l-2.5-2.5M13 10H4l2.5 2.5';
const CROSS = 'M4 4l8 8M12 4l-8 8';

function Icon({ d, width = 1.8 }: { d: string; width?: number }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Column names above the rows (not interactive), with an empty cell over the drag handle. */
export function CompareHead({ stripView }: { stripView: string }) {
  const hide = (key: string) => stripView !== 'all' && key !== stripView;
  return (
    <div className="cmap-head" aria-hidden="true">
      <span />
      <span>Name</span>
      {VIEWS.map((v) => (
        <span key={v.key} data-view={v.key} hidden={hide(v.key)}>
          {v.label}
        </span>
      ))}
      {RATING_COLS.map((c) => (
        <span key={c.key} className="cmap-head-rc" title={c.label}>
          {c.abbr}
        </span>
      ))}
      <span className="cmap-head-end" />
    </div>
  );
}

export interface CompareRowProps {
  map: ColormapEntry;
  index: number;
  reversed: boolean;
  stripView: string;
  /** The rows' elements, read when a drag starts. */
  boxRef: { current: HTMLDivElement | null };
  onMove: (name: string, d: number) => void;
  onReorder: (from: number, to: number) => void;
  onFlip: (name: string) => void;
  onRemove: (name: string) => void;
}

export const CompareRow = memo(function CompareRow({
  map,
  index,
  reversed,
  stripView,
  boxRef,
  onMove,
  onReorder,
  onFlip,
  onRemove,
}: CompareRowProps) {
  const { name } = map;
  const grip = useRef<HTMLButtonElement>(null);
  const label = (what: string) => `${what} ${name}`;
  return (
    <div className="cmap-item">
      <div className="cmap-row">
        <button
          ref={grip}
          className="cmap-toggle cmap-sm cmap-grip"
          type="button"
          title={label('Drag to reorder (or press ↑ ↓):')}
          aria-label={label('Drag to reorder (or press ↑ ↓):')}
          data-act="drag"
          data-name={name}
          onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
            const items = [...(boxRef.current?.querySelectorAll<HTMLElement>('.cmap-item') ?? [])];
            startRowDrag(e.nativeEvent, e.currentTarget, items, index, onReorder);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            onMove(name, e.key === 'ArrowUp' ? -1 : 1);
          }}
        >
          <Icon d={GRIP} width={2.6} />
        </button>
        <div className="cmap-name">
          <code>{name}</code>
          <RatingPills map={map} />
        </div>
        {VIEWS.map((v, j) => (
          <div
            key={v.key}
            className={j === 0 ? 'cmap-cell main' : 'cmap-cell'}
            data-view={v.key}
            hidden={stripView !== 'all' && v.key !== stripView}
          >
            <span className="cmap-cap">{v.label}</span>
            <ProbeStrip map={map} view={v.key} reversed={reversed} />
          </div>
        ))}
        <RatingCells map={map} />
        <div className="cmap-actions">
          <button
            className="cmap-toggle cmap-sm"
            type="button"
            title={`${reversed ? 'Reversed: show' : 'Reverse'} ${name}${reversed ? ' in its original direction' : ' in the plots and test images'}`}
            aria-label={label('Reverse')}
            aria-pressed={reversed}
            data-act="rev"
            data-name={name}
            onClick={() => onFlip(name)}
          >
            <Icon d={FLIP} />
          </button>
          <button
            className="cmap-toggle cmap-sm"
            type="button"
            title={label('Remove from comparison:')}
            aria-label={label('Remove from comparison:')}
            data-act="remove"
            data-name={name}
            onClick={() => onRemove(name)}
          >
            <Icon d={CROSS} />
          </button>
        </div>
      </div>
    </div>
  );
});

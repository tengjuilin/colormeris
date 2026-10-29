import { createContext, type Dispatch, memo, useCallback, useContext, useLayoutEffect, useRef } from 'react';
import { cmapData } from '../../../core/colormap-library.ts';
import type { ColormapEntry } from '../../../types/index.ts';
import { VIEWS } from '../../common.ts';
import { COMPARE_MAX } from '../../route.ts';
import { DetailBody } from '../detail/detail-body.tsx';
import { useFocusRegistry } from '../focus-registry.ts';
import { ProbeStrip } from '../shared/probe-strip.tsx';
import { RatingCells, RatingPills } from '../shared/rating.tsx';
import type { ViewerAction } from '../viewer-state.ts';
import { userOpenOf } from './open-state.ts';
import { useRowVisible } from './use-row-visible.ts';

// One map of the Browse list. Every map has a row from the start, but until it
// comes near the viewport it is a shell: the empty .cmap-row and the hidden
// panel, which is all that search, filters, sort and Compare need. Building
// the rest (name, five strips, rating glyphs, buttons: about 40 elements) for
// over 1000 maps took most of the start-up time.
//
// A shell must cost almost nothing to render, because a sort, a search or a
// global Reversed would otherwise render over a thousand of them. So `Row`'s
// props are primitives that a shell needs (and `dispatch` is stable): a sort
// renders no row, and the search's `hidden` is set on the DOM by BrowseList
// (it is not a prop). What only a built row shows (its direction, the strip
// view, whether the comparison is full) reaches it through RowViewContext, so
// only built rows (and the open detail under a row) re-render for those.

const BY_NAME = new Map<string, ColormapEntry>(cmapData.maps.map((m) => [m.name, m]));

export interface RowProps {
  name: string;
  /** Position in the default list: numbers the panel's id. */
  index: number;
  compared: boolean;
  /** Its detail is open (in the drawer or under the row). */
  open: boolean;
  /** Its detail is shown under the row (open on a narrow screen). */
  inline: boolean;
  /** Greater than 0 when a link asks for this row: build it now and open its folds. */
  forceBuild: number;
  dispatch: Dispatch<ViewerAction>;
}

/** What built rows share: the global Reversed, the maps flipped one by one, the strip view, the comparison's cap. */
export interface RowView {
  reversed: boolean;
  flipped: ReadonlySet<string>;
  stripView: string;
  compareFull: boolean;
}
export const RowViewContext = createContext<RowView>({
  reversed: false,
  flipped: new Set(),
  stripView: 'all',
  compareFull: false,
});

const DOWN = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M4 6l4 4 4-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const CMP = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      className="i-add"
      d="M8 3.5v9M3.5 8h9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      className="i-on"
      d="M3.5 8.5l3 3 6-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const FLIP = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M3 6h9l-2.5-2.5M13 10H4l2.5 2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** A revealed row opens the folds it sits in, and remembers that as the user's choice. */
function openAncestors(item: HTMLElement | null) {
  for (const sel of ['details.cmap-sub', 'details.cmap-section']) {
    const d = item?.closest<HTMLDetailsElement>(sel);
    if (d) {
      d.open = true;
      userOpenOf.set(d, true);
    }
  }
}

const directionOf = (view: RowView, name: string) => view.reversed !== view.flipped.has(name);

export const Row = memo(function Row({ name, index, compared, open, inline, forceBuild, dispatch }: RowProps) {
  const map = BY_NAME.get(name) as ColormapEntry;
  const item = useRef<HTMLDivElement>(null);
  const built = useRowVisible(item, forceBuild > 0 || open);
  const panelId = `cmap-panel-${index + 1}`;

  useLayoutEffect(() => {
    if (forceBuild > 0) openAncestors(item.current);
  }, [forceBuild]);

  const cls = `cmap-item${built ? ' built' : ''}${open ? ' open' : ''}${compared ? ' compared' : ''}`;
  return (
    <div className={cls} data-name={name.toLowerCase()} ref={item}>
      <div className="cmap-row">
        {built && (
          <BuiltRow map={map} panelId={panelId} compared={compared} open={open} inline={inline} dispatch={dispatch} />
        )}
      </div>
      <div className="cmap-panel" id={panelId} hidden={!inline}>
        {inline && <InlineDetail map={map} compared={compared} dispatch={dispatch} />}
      </div>
    </div>
  );
});

/** The detail of the open map under its row (a narrow screen). */
function InlineDetail({
  map,
  compared,
  dispatch,
}: {
  map: ColormapEntry;
  compared: boolean;
  dispatch: Dispatch<ViewerAction>;
}) {
  const view = useContext(RowViewContext);
  const registry = useFocusRegistry();
  const name = map.name;
  const close = useCallback(() => {
    registry.returnTo = name;
    dispatch({ type: 'OPEN', name: null });
  }, [registry, name, dispatch]);
  return (
    <DetailBody
      map={map}
      reversed={directionOf(view, name)}
      compared={compared}
      compareFull={view.compareFull}
      onClose={close}
      dispatch={dispatch}
    />
  );
}

/** What a row shows once it is near the viewport. */
function BuiltRow({
  map,
  panelId,
  compared,
  open,
  inline,
  dispatch,
}: {
  map: ColormapEntry;
  panelId: string;
  compared: boolean;
  open: boolean;
  inline: boolean;
  dispatch: Dispatch<ViewerAction>;
}) {
  const view = useContext(RowViewContext);
  const registry = useFocusRegistry();
  const name = map.name;
  const reversed = directionOf(view, name);
  const preFlipped = view.flipped.has(name) && !!map.flip;
  const { stripView, compareFull } = view;

  const setOpenButton = useCallback(
    (el: HTMLButtonElement | null) => {
      if (!el) return;
      registry.buttons.set(name, el);
      return () => {
        registry.buttons.delete(name);
      };
    },
    [registry, name],
  );
  const toggle = () => dispatch({ type: 'OPEN', name: open ? null : name });

  return (
    <>
      <div className="cmap-name">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the open button next to it is the keyboard path */}
        <code className="cmap-name-link" title={`Show details of ${name}`} onClick={toggle}>
          {name}
        </code>
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
          type="button"
          className="cmap-toggle cmap-sm"
          data-act="rev"
          aria-pressed={reversed}
          aria-label={`Reverse ${name}`}
          title={
            reversed
              ? `Shown reversed${preFlipped ? ' (to run the same way as its neighbors)' : ''}: click to show ${name} in its original direction`
              : `Reverse ${name}`
          }
          onClick={() => dispatch({ type: 'TOGGLE_FLIP', name })}
        >
          {FLIP}
        </button>
        <button
          type="button"
          className="cmap-toggle cmap-cmp"
          aria-pressed={compared}
          disabled={!compared && compareFull}
          title={
            compared
              ? `Remove ${name} from comparison`
              : compareFull
                ? `Up to ${COMPARE_MAX} maps can be compared`
                : `Add ${name} to comparison`
          }
          onClick={() => dispatch({ type: 'SET_COMPARED', name, on: !compared })}
        >
          {CMP}
        </button>
        <button
          type="button"
          className="cmap-toggle cmap-open-btn"
          ref={setOpenButton}
          aria-expanded={open}
          aria-controls={open && !inline ? 'cmap-drawer' : panelId}
          aria-label={`Details of ${name}`}
          title="Show plots and details"
          onClick={toggle}
        >
          {DOWN}
        </button>
      </div>
    </>
  );
}

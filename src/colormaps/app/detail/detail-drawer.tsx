import { type Dispatch, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { cmapData } from '../../../core/colormap-library.ts';
import type { ColormapEntry } from '../../../types/index.ts';
import type { ViewerAction } from '../viewer-state.ts';
import { DetailBody } from './detail-body.tsx';

// The drawer at the right of the Browse list (wide screens) that holds the
// detail of the open map. It is always rendered, so the shell can measure it;
// it is hidden unless a map is open on the Browse tab on a wide screen, and
// has a body only then (on narrower screens the row shows the detail inline).
// Escape closes the open detail in both places: it asks the shell to put focus
// back on the row's button (onClose), then dispatches OPEN null. Escape is
// left alone when something else took it (defaultPrevented, a popover, a text
// field or a select).

const BY_NAME = new Map<string, ColormapEntry>(cmapData.maps.map((m) => [m.name, m]));

export interface DetailDrawerProps {
  /** Name of the open map. */
  open: string | null;
  wide: boolean;
  tab: string;
  reversed: boolean;
  compared: boolean;
  compareFull: boolean;
  /** The open detail is being closed (button or Escape); `name` is the map. */
  onClose: (name: string) => void;
  dispatch: Dispatch<ViewerAction>;
}

function popoverOpen(): boolean {
  try {
    return document.querySelector(':popover-open') !== null;
  } catch {
    return false; // no :popover-open (old engines)
  }
}

export const DetailDrawer = forwardRef<HTMLElement, DetailDrawerProps>(function DetailDrawer(
  { open, wide, tab, reversed, compared, compareFull, onClose, dispatch },
  ref,
) {
  const aside = useRef<HTMLElement>(null);
  useImperativeHandle(ref, () => aside.current as HTMLElement);
  const map = open ? BY_NAME.get(open) : undefined;
  const shown = !!map && wide && tab === 'browse';

  const close = useRef<() => void>(() => {});
  close.current = () => {
    if (!open) return;
    onClose(open);
    dispatch({ type: 'OPEN', name: null });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if ((e.target as Element | null)?.closest?.('input, select, textarea') || popoverOpen()) return;
      close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // A map opened in the drawer starts at the top; showing the same map again
  // (another tab and back, a resize) keeps the place.
  const seen = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (seen.current === open) return;
    seen.current = open;
    if (shown && aside.current) aside.current.scrollTop = 0;
  }, [open, shown]);

  return (
    <aside ref={aside} className="cmap-drawer" id="cmap-drawer" aria-label="Colormap details" hidden={!shown}>
      {map && wide && (
        <DetailBody
          map={map}
          reversed={reversed}
          compared={compared}
          compareFull={compareFull}
          onClose={() => close.current()}
          dispatch={dispatch}
        />
      )}
    </aside>
  );
});

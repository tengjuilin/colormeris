import { type RefObject, useEffect, useRef } from 'react';
import { flushSafely } from '../../ui/flush.ts';
import { createScrollAnchor, type ScrollAnchor } from '../scroll-anchor.ts';

// Keeps the reader's place when the window is resized (the DOM core is
// scroll-anchor.ts). A resize can move the open detail between the drawer
// (wide) and the list (narrow), which changes the page's length; the part of
// the page at the top of the visible area must stay there.
//
// The resize handler does what the old viewer did: freeze the anchor, change
// the layout, restore. The layout change is `setWide`, flushed synchronously
// so the DOM is final when `restore` measures it; a media-query `change`
// event can arrive after the resize event, or not at all in a background
// window, so the handler reads the query itself. flushSafely refuses to nest
// inside React's own flush, and the update then queues as usual.

export const WIDE = '(min-width: 1200px)';

/** The drawer sits under the top bar, whatever its height is now. */
export function placeDrawerTop() {
  const bar = document.querySelector('.topbar');
  document.documentElement.style.setProperty(
    '--cmap-drawer-top',
    `${bar ? Math.round(bar.getBoundingClientRect().bottom) : 0}px`,
  );
}

export interface ScrollAnchorOptions {
  refs: {
    root: RefObject<HTMLElement | null>;
    top: RefObject<HTMLElement | null>;
    drawer: RefObject<HTMLElement | null>;
  };
  /** The open map's `.cmap-row` in the list, or null when none is open. */
  getOpenRow: () => HTMLElement | null;
  tab: string;
  /** Whether the wide layout (drawer) is in use now. */
  wide: boolean;
  setWide: (v: boolean) => void;
  /** The media query behind `wide`. */
  query?: string;
}

export function useScrollAnchor({ refs, getOpenRow, tab, wide, setWide, query = WIDE }: ScrollAnchorOptions) {
  const latest = useRef({ getOpenRow, tab, wide, setWide, query });
  latest.current = { getOpenRow, tab, wide, setWide, query };
  const anchor = useRef<ScrollAnchor | null>(null);

  useEffect(() => {
    const root = refs.root.current;
    const top = refs.top.current;
    if (!root || !top) return;
    const sa = createScrollAnchor({ root, top });
    anchor.current = sa;

    const onResize = () => {
      // Widening past 820px would leave the document scrolled with no
      // scrollbar, hiding the whole page.
      if (window.innerWidth > 820 && window.scrollY) window.scrollTo(0, 0);
      const cur = latest.current;
      const drawer = refs.drawer.current;
      sa.freeze(drawer);
      const from = cur.wide;
      const to = typeof window.matchMedia === 'function' ? window.matchMedia(cur.query).matches : from;
      const hadOpen = cur.getOpenRow() !== null;
      if (from !== to) {
        latest.current.wide = to; // the next resize event may come before the render
        if (!flushSafely(() => cur.setWide(to))) cur.setWide(to);
      }
      if (to) placeDrawerTop();
      sa.restore(hadOpen && from !== to ? { from: from ? 'drawer' : 'inline', to: to ? 'drawer' : 'inline' } : null, {
        drawer,
        openRow: cur.getOpenRow(),
        tab: cur.tab,
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      sa.dispose();
      anchor.current = null;
    };
  }, [refs]);
}

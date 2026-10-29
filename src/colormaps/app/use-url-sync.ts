import { type Dispatch, type RefObject, useEffect, useRef } from 'react';
import { formatViewerUrl, parseViewerRoute, VIEWER_TABS } from '../route.ts';
import type { ViewerAction, ViewerState } from './viewer-state.ts';

// The page's link and the state, both ways.
//
// State to link: after each change of the tab, the open map or the comparison
// the link is written as `?compare=…&map=…#tab`. A change made from code
// (Identify's Show button) adds a history entry (`state.history === 'push'`),
// everything else replaces the current one, so opening maps and picking maps
// adds no entries. The link is only written when it differs, so a link change
// that came from the browser (Back, a tab link) is not written back. The hash
// is left alone unless the tab changed or is missing: it may be a #ref-… link
// into the footer.
//
// Link to state: `hashchange` and `popstate` parse the link and dispatch
// ROUTE_FROM_URL (the reducer keeps the tab when the link has none). A
// #ref-… or #cmap-about link also opens the footer, and so does a click on
// one, before the browser jumps to it.

const FOOTER_LINK = 'a[href^="#ref-"], a[href="#cmap-about"]';

function replaceOrPush(kind: 'push' | 'replace', url: string) {
  try {
    if (kind === 'push') history.pushState(history.state, '', url);
    else history.replaceState(history.state, '', url);
  } catch (err) {
    console.warn('Could not update the link', err); // for example some file:// setups
  }
}

export function useUrlSync(
  state: ViewerState,
  dispatch: Dispatch<ViewerAction>,
  names: string[],
  footer: RefObject<HTMLDetailsElement | null>,
) {
  const { tab, open, compare } = state;
  const kind = useRef(state.history);
  kind.current = state.history;
  const lastTab = useRef(tab);

  useEffect(() => {
    // Every history entry gets its tab, so Back returns to the right one. A
    // hash that names another tab (?map=x#compare opens Browse) is replaced;
    // one that is no tab (#ref-…) is kept.
    const named = location.hash.slice(1).toLowerCase();
    const stale = VIEWER_TABS.includes(named) && named !== tab;
    const hash = tab !== lastTab.current || !location.hash || stale ? `#${tab}` : location.hash;
    lastTab.current = tab;
    const url = formatViewerUrl(
      { selected: compare, open },
      { pathname: location.pathname, search: location.search, hash },
    );
    if (url === `${location.pathname}${location.search}${location.hash}`) return;
    replaceOrPush(kind.current === 'push' && location.hash !== hash ? 'push' : 'replace', url);
  }, [tab, open, compare]);

  useEffect(() => {
    const onLink = () => {
      const route = parseViewerRoute(location.search, location.hash, names);
      // No tab in the link (#ref-…): the tab stays, the map and comparison still follow the link.
      dispatch({ type: 'ROUTE_FROM_URL', route });
      if (!route.tab && /^#(ref-|cmap-about)/.test(location.hash) && footer.current) footer.current.open = true;
    };
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.(FOOTER_LINK) && footer.current) footer.current.open = true;
    };
    window.addEventListener('hashchange', onLink);
    window.addEventListener('popstate', onLink);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('hashchange', onLink);
      window.removeEventListener('popstate', onLink);
      document.removeEventListener('click', onClick);
    };
  }, [dispatch, names, footer]);
}

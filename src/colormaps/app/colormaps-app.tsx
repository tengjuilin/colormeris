import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { cmapData } from '../../core/colormap-library.ts';
import type { ColormapEntry } from '../../types/index.ts';
import type { FigureLine } from '../figure-input.ts';
import { isRev, metrics } from '../library-cache.ts';
import { COMPARE_MAX, parseViewerRoute } from '../route.ts';
import { getTooltip } from '../tooltip-element.ts';
import { isShown } from './browse/browse-model.ts';
import { BrowseTab } from './browse/browse-tab.tsx';
import { CompareTab, CompareTray } from './compare/index.ts';
import { CvdTab } from './cvd/index.ts';
import { DetailDrawer } from './detail/index.ts';
import { createFocusRegistry, FocusRegistryContext } from './focus-registry.ts';
import { Footer } from './footer.tsx';
import { IdentifyTab } from './identify/index.ts';
import { RecolorTab, type RecolorTabProps } from './recolor/index.ts';
import { TooltipProvider } from './shared/tooltip.tsx';
import { useMediaQuery } from './use-media-query.ts';
import { placeDrawerTop, useScrollAnchor, WIDE } from './use-scroll-anchor.ts';
import { useUrlSync } from './use-url-sync.ts';
import { DispatchContext, ViewerStateContext } from './viewer-context.ts';
import { initFromRoute, loadStripView, saveStripView, type ViewerState, viewerReducer } from './viewer-state.ts';

// The colormap viewer page (colormaps.html), in five tabs:
//   Browse    every colormap as five vector strips (as seen, three
//             color-vision-deficiency simulations, grayscale) with rating
//             columns; one map at a time opens in the detail view (app/detail)
//   Compare   up to 10 maps side by side (app/compare; the tray too)
//   Identify  find the colormap of a figure (app/identify)
//   Recolor   redraw a figure in another colormap (app/recolor)
//   CVD       a figure next to a color-vision-deficiency simulation (app/cvd)
// The tab, the open map and the comparison live in the URL (route.ts,
// use-url-sync.ts). The data comes from core/colormap-library.ts, so the page
// needs no fetch and works from file://.
//
// This component holds the state (viewer-state.ts), hands it to the tabs as
// props, and owns what is outside them: the sticky bar and the list (Browse),
// the detail drawer, the tray, the footer, and the effects that reach into the
// page (body classes, scroll, focus, the tooltip).

const MAPS = cmapData.maps;
const NAMES = MAPS.map((m) => m.name);
const BY_NAME = new Map<string, ColormapEntry>(MAPS.map((m) => [m.name, m]));

function init(): ViewerState {
  return initFromRoute(parseViewerRoute(location.search, location.hash, NAMES), {
    // The sequential maps the export script marked `flip` run dark to light in Browse.
    flipped: MAPS.filter((m) => m.flip).map((m) => m.name),
    stripView: loadStripView(),
  });
}

// The rating metrics take a few ms per map: rows compute theirs when built, and
// the rest are computed while the page is idle, so sorting and filtering by rating stay quick.
function idle(cb: (d: { timeRemaining(): number }) => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(cb);
    return () => cancelIdleCallback(id);
  }
  const t = setTimeout(() => cb({ timeRemaining: () => 8 }), 50);
  return () => clearTimeout(t);
}

function useRatingsPrecompute() {
  useEffect(() => {
    let i = 0;
    let cancel = () => {};
    const step = (d: { timeRemaining(): number }) => {
      while (i < MAPS.length && d.timeRemaining() > 4) metrics(MAPS[i++]);
      if (i < MAPS.length) cancel = idle(step);
    };
    cancel = idle(step);
    return () => cancel();
  }, []);
}

const Compare = memo(CompareTab);
const Tray = memo(CompareTray);
const Identify = memo(IdentifyTab);
const Recolor = memo(RecolorTab);
const Cvd = memo(CvdTab);

export function ColormapsApp() {
  const [state, dispatch] = useReducer(viewerReducer, undefined, init);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [wide, setWide] = useMediaQuery(WIDE);
  const [registry] = useState(createFocusRegistry);
  const innerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const footerRef = useRef<HTMLDetailsElement>(null);
  const { tab, open, compare, reversed, flipped, stripView } = state;

  // The page element React renders into (#cmap-root): its classes and scrolling are the page's.
  useLayoutEffect(() => {
    rootRef.current = innerRef.current?.parentElement ?? null;
  }, []);

  useUrlSync(state, dispatch, NAMES, footerRef);
  useRatingsPrecompute();

  const getOpenRow = useCallback(
    () =>
      stateRef.current.open
        ? (registry.buttons.get(stateRef.current.open)?.closest<HTMLElement>('.cmap-row') ?? null)
        : null,
    [registry],
  );
  const anchorRefs = useMemo(() => ({ root: rootRef, top: topRef, drawer: drawerRef }), []);
  useScrollAnchor({ refs: anchorRefs, getOpenRow, tab, wide, setWide });

  // ---- what reaches into the page ----

  // Strip view: one view wider, or all five. Remembered across visits.
  useLayoutEffect(() => {
    rootRef.current?.classList.toggle('cmap-single', stripView !== 'all');
  }, [stripView]);
  const savedView = useRef(stripView);
  useEffect(() => {
    if (stripView === savedView.current) return;
    savedView.current = stripView;
    saveStripView(stripView);
  }, [stripView]);

  // The drawer is open on wide screens, on Browse: the page makes room for it.
  const drawerShown = !!open && wide && tab === 'browse';
  useLayoutEffect(() => {
    document.body.classList.toggle('cmap-drawer-open', drawerShown);
    if (drawerShown) placeDrawerTop();
    return () => document.body.classList.remove('cmap-drawer-open');
  }, [drawerShown]);

  // The tray shows on Browse while there are maps; the page makes room for it.
  const trayOn = compare.length > 0 && tab === 'browse';
  useLayoutEffect(() => {
    document.body.classList.toggle('cmap-tray-on', trayOn);
    return () => document.body.classList.remove('cmap-tray-on');
  }, [trayOn]);

  // A new tab starts at its top; the list keeps its place within Browse.
  const shownTab = useRef(tab);
  useLayoutEffect(() => {
    if (shownTab.current === tab) return; // the first render, and StrictMode's second run of an effect
    shownTab.current = tab;
    if (rootRef.current) rootRef.current.scrollTop = 0;
    window.scrollTo?.(0, 0);
  }, [tab]);

  // Closing the detail returns focus to its row's button.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `open` is the trigger
  useLayoutEffect(() => {
    const name = registry.returnTo;
    if (!name) return;
    registry.returnTo = null;
    registry.buttons.get(name)?.focus();
  }, [open, registry]);

  // A map shown from a link (?map=, Identify's Show): scroll to its row, which is built and in an open
  // fold by now (Row's layout effect). After the drawer's body class, which changes the page's width.
  const firstReveal = useRef(state.reveal);
  const handled = useRef<ViewerState['reveal']>(null);
  useLayoutEffect(() => {
    const r = state.reveal;
    if (!r || handled.current === r) return;
    handled.current = r;
    const item = registry.buttons.get(r.name)?.closest<HTMLElement>('.cmap-item');
    const root = rootRef.current;
    if (!item || !root) return;
    const behavior = firstReveal.current === r ? 'auto' : 'smooth';
    // Above 820px only the page pane scrolls; scrollIntoView would also
    // scroll the overflow-hidden document and push the top bar away.
    if (getComputedStyle(root).overflowY === 'auto') {
      const a = item.getBoundingClientRect();
      const p = root.getBoundingClientRect();
      root.scrollBy?.({ top: a.top - p.top - (p.height - a.height) / 2, behavior });
    } else {
      item.scrollIntoView?.({ behavior, block: 'center' });
    }
  }, [state.reveal, registry]);

  // The tooltip hangs over nothing but what it describes.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const tip = getTooltip();
    const onMove = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.('.cmap-strip, .cmap-plot, .cmap-sine-img')) tip.hideTip();
    };
    const onLeave = () => tip.hideTip();
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerleave', onLeave);
    return () => {
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a direction change is the trigger
  useEffect(() => getTooltip().hideTip(), [reversed, flipped]);

  // ---- props for the tabs ----

  // Each compared map's direction in Browse; the same array while nothing changed.
  const bits = compare.map((n) => (isRev({ reversed, flipped }, n) ? '1' : '0')).join('');
  const browseRevCache = useRef<{ compare: readonly string[]; bits: string; value: boolean[] } | null>(null);
  if (browseRevCache.current?.compare !== compare || browseRevCache.current.bits !== bits) {
    browseRevCache.current = { compare, bits, value: [...bits].map((b) => b === '1') };
  }
  const browseRev = browseRevCache.current.value;

  const getTab = useCallback(() => stateRef.current.tab, []);
  const onCompareChange = useCallback((names: readonly string[]) => dispatch({ type: 'SET_COMPARE_LIST', names }), []);
  const onToggleFlip = useCallback((name: string) => dispatch({ type: 'TOGGLE_COMPARE_REV', name }), []);
  const onCompare = useCallback((name: string, on: boolean) => dispatch({ type: 'SET_COMPARED', name, on }), []);
  const onShowRow = useCallback((name: string) => {
    const map = BY_NAME.get(name);
    const s = stateRef.current;
    if (map) dispatch({ type: 'SHOW_ROW', name, hidden: !isShown(map, s.query, s.filters) });
  }, []);
  const [incoming, setIncoming] = useState<RecolorTabProps['incoming']>(null);
  const incomingId = useRef(0);
  const onRecolor = useCallback((file: File, line: FigureLine | null) => {
    setIncoming({ id: ++incomingId.current, file, line });
    dispatch({ type: 'GO_TAB', tab: 'recolor' });
  }, []);
  const cvdSeen = useRef(false);
  if (tab === 'cvd') cvdSeen.current = true;

  const onDetailClose = useCallback(
    (name: string) => {
      registry.returnTo = name;
    },
    [registry],
  );

  return (
    <ViewerStateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        <FocusRegistryContext.Provider value={registry}>
          <TooltipProvider tab={tab}>
            <div className="cmap-inner" ref={innerRef}>
              <h1>Colormaps</h1>
              <p className="cmap-intro">
                {`The ${MAPS.length} colormaps of Matplotlib, CMasher, Crameri’s Scientific colour maps, cmocean, colorcet, seaborn, CarbonPlan, NCL, SciVisColor, CARTOColors, MATLAB and R packages as seen, as simulated for three kinds of color-vision deficiency, and in grayscale, rated for uniformity, CVD and grayscale safety, and how well values can be read back. Hover a strip for its values; click to copy the hex.`}
              </p>
              <BrowseTab
                tab={tab}
                open={open}
                compare={compare}
                reversed={reversed}
                flipped={flipped}
                stripView={stripView}
                sort={state.sort}
                query={state.query}
                filters={state.filters}
                reveal={state.reveal}
                wide={wide}
                topRef={topRef}
              />
              <section
                className="cmap-compare"
                id="cmap-compare"
                aria-labelledby="cmap-compare-count"
                hidden={tab !== 'compare'}
              >
                <Compare
                  active={tab === 'compare'}
                  compare={compare}
                  compareFlipped={state.compareFlipped}
                  browseRev={browseRev}
                  stripView={stripView}
                  onCompareChange={onCompareChange}
                  onToggleFlip={onToggleFlip}
                />
              </section>
              <section className="cmap-identify" aria-labelledby="cmap-identify-title" hidden={tab !== 'identify'}>
                <Identify
                  getTab={getTab}
                  compared={compare}
                  onShowRow={onShowRow}
                  onCompare={onCompare}
                  onRecolor={onRecolor}
                />
              </section>
              <section className="cmap-recolor" aria-labelledby="cmap-recolor-title" hidden={tab !== 'recolor'}>
                <Recolor getTab={getTab} incoming={incoming} />
              </section>
              <section className="cmap-cvd" aria-labelledby="cmap-cvd-title" hidden={tab !== 'cvd'}>
                <Cvd active={cvdSeen.current} getTab={getTab} />
              </section>
              <Footer ref={footerRef} />
            </div>
            <DetailDrawer
              ref={drawerRef}
              open={open}
              wide={wide}
              tab={tab}
              reversed={open ? isRev({ reversed, flipped }, open) : false}
              compared={!!open && compare.includes(open)}
              compareFull={compare.length >= COMPARE_MAX}
              onClose={onDetailClose}
              dispatch={dispatch}
            />
            {/* biome-ignore lint/a11y/useSemanticElements: the tray is a bar at the bottom, as before, not a <section> */}
            <div className="cmap-tray" role="region" aria-label="Comparison" hidden={!trayOn}>
              <Tray
                compare={compare}
                browseRev={browseRev}
                compareFlipped={state.compareFlipped}
                onCompareChange={onCompareChange}
              />
            </div>
          </TooltipProvider>
        </FocusRegistryContext.Provider>
      </DispatchContext.Provider>
    </ViewerStateContext.Provider>
  );
}

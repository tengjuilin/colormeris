import { cmapData } from '../core/colormap-library.ts';
import type { CmapListItem, CmapViewerContext, CmapViewerState, ColormapEntry, ViewKey } from '../types/index.ts';
import { anchorPopover, clamp8, el, GLYPH, PILL, pct, RATING_COLS, roundRgb, svgEl, VIEWS } from './common.ts';
import { setupCmapFooter } from './footer.ts';
import {
  base,
  sepOf as cachedSepOf,
  viewData as cachedViewData,
  isRev as directionOf,
  metrics,
  notesOf,
} from './library-cache.ts';
import { setupCmapPlots } from './plots.ts';
import { formatViewerUrl, parseViewerRoute, VIEWER_TABS } from './route.ts';
import { keepPlaceOnResize } from './scroll-anchor.ts';
import { setupCmapStrips } from './strips.ts';
import { setupCmapBrowse } from './tabs/browse-tab.ts';
import { setupCmapCompare } from './tabs/compare-tab.ts';
import { setupCmapCvd } from './tabs/cvd-tab.ts';
import { setupCmapDetail } from './tabs/detail-drawer.ts';
import { setupCmapIdentify } from './tabs/identify-tab.ts';
import { setupCmapRecolor } from './tabs/recolor-tab.ts';

// The colormap viewer page (colormaps.html), in five tabs:
//   Browse    every colormap as five vector SVG strips (as seen, three
//             color-vision-deficiency simulations, grayscale) with rating
//             columns; one map at a time opens in the detail view (detail-drawer.js)
//   Compare   up to 10 maps side by side (compare-tab.js)
//   Identify  find the colormap of a figure (identify-tab.js)
//   Recolor   redraw a figure in another colormap (recolor-tab.js)
//   CVD       a figure next to a color-vision-deficiency simulation (cvd-tab.js)
// The tab, the open map and the comparison live in the URL (route.js). The
// data comes from core/colormap-library.js, so the page needs no fetch and
// works from file://.
//
// This file holds the shared state, the colors and metrics of each map, the
// ratings, the tabs and the page assembly. Every module gets the shared
// `ctx` built here:
//   common.js         DOM helpers and constants
//   strips.js         strips and the shared tooltip
//   plots.js          SVG plots and per-position profiles
//   footer.js         references and the footer
//   browse-tab.js     the Browse tab (rows, controls, sort, filters)
//   detail-drawer.js, compare-tab.js, identify-tab.js, recolor-tab.js, cvd-tab.js
//   scroll-anchor.js  keeps the reader's place on resize

export function setupColormapViewer(root: HTMLElement) {
  const data = cmapData;
  if (!data) throw new Error('core/colormap-library.js did not load');

  const names = data.maps.map((m) => m.name);
  const route = parseViewerRoute(location.search, location.hash, names);
  // Shared with the modules. `selected` is the comparison (?compare=),
  // `open` the map in the detail view (?map=). Browse sets stripView.
  const state: CmapViewerState = {
    reversed: false,
    selected: route.compare,
    open: null,
    tab: 'browse',
    stripView: 'all',
    sort: null,
    // Maps shown the other way round in Browse. It starts with the sequential
    // maps the export script marked `flip`, so every Sequential map runs dark to light.
    flipped: new Set(data.maps.filter((m) => m.flip).map((m) => m.name)),
  };
  // A map's direction in Browse: its own toggle, then the global Reversed.
  const isRev = (map: ColormapEntry) => directionOf(state, map.name);
  const items: CmapListItem[] = []; // { map, item, strips: [el], panel, button, cmpBtn, order }
  const mapByName = new Map(data.maps.map((m) => [m.name, m]));

  // Colors, metrics and notes are module-level caches (library-cache.ts); the
  // members below add the viewer's state, the default direction of a map.
  // `reversed` defaults to the map's Browse direction; the Compare tab passes its own.
  const viewData = (map: ColormapEntry, view: ViewKey, reversed = isRev(map)) => cachedViewData(map, view, reversed);
  const sepOf = (map: ColormapEntry, key: string) => cachedSepOf(map, key, isRev(map));
  const rev = <T>(a: T[], reversed = state.reversed) => (reversed ? a.slice().reverse() : a);

  // ---- ratings ----

  // Pills under the name: on phones in the list, and in the comparison table.
  function ratingPills(map: ColormapEntry) {
    const wrap = el('div', { class: 'cmap-badges' });
    for (const n of notesOf(map)) {
      const b = el('span', { class: `cmap-pill ${n.rating}`, title: `${n.label}: ${n.rating}. ${n.text}` });
      b.append(el('span', { class: 'cmap-glyph', 'aria-hidden': 'true' }, GLYPH[n.rating]), PILL[n.key]);
      b.append(el('span', { class: 'sr-only' }, `: ${n.rating}`));
      wrap.append(b);
    }
    return wrap;
  }

  // One glyph per rating column, so ratings can be scanned down the list.
  function ratingCells(map: ColormapEntry) {
    const notes = notesOf(map);
    return RATING_COLS.map((c) => {
      const n = notes.find((x) => x.key === c.key);
      if (!n) return el('span', { class: 'cmap-rc na', title: `${c.label}: does not apply to qualitative maps` }, '—');
      const s = el('span', { class: `cmap-rc ${n.rating}`, title: `${c.label}: ${n.rating}. ${n.text}` });
      s.append(
        el('span', { 'aria-hidden': 'true' }, GLYPH[n.rating]),
        el('span', { class: 'sr-only' }, `${c.label}: ${n.rating}`),
      );
      return s;
    });
  }

  // ---- tabs ----

  const TAB_TITLES: Record<string, string> = {
    browse: 'Browse',
    compare: 'Compare',
    identify: 'Identify',
    recolor: 'Recolor',
    cvd: 'CVD',
  };
  const tabLinks = new Map();

  function buildTabs() {
    const nav = el('nav', { class: 'cmap-viewtabs', 'aria-label': 'Colormap tools' });
    for (const t of VIEWER_TABS) {
      const a = el('a', { href: `#${t}` }, TAB_TITLES[t]);
      tabLinks.set(t, a);
      nav.append(a);
    }
    return nav;
  }

  function syncTabs() {
    const n = state.selected.length;
    tabLinks.get('compare').textContent = n ? `Compare (${n})` : 'Compare';
  }

  function setTab(tab: string, { scroll = true } = {}) {
    if (!VIEWER_TABS.includes(tab)) return;
    const changed = tab !== state.tab;
    state.tab = tab;
    for (const [t, a] of tabLinks) {
      if (t === tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    const browsing = tab === 'browse';
    browse.bar.hidden = !browsing;
    browse.header.hidden = !browsing;
    browse.list.hidden = !browsing;
    compare.sec.hidden = tab !== 'compare';
    identify.sec.hidden = tab !== 'identify';
    recolor.sec.hidden = tab !== 'recolor';
    cvd.sec.hidden = tab !== 'cvd';
    if (tab === 'compare') compare.show();
    if (tab === 'cvd') cvd.show();
    ctx.hideTip();
    detail.place();
    compare.syncTray();
    // A new tab starts at its top; the list keeps its place within Browse.
    if (changed && scroll) {
      root.scrollTop = 0;
      window.scrollTo(0, 0);
    }
  }

  // Switch tabs from code (Identify's Show button), as a history entry.
  function goTab(tab: string) {
    if (location.hash !== `#${tab}`) {
      try {
        history.pushState(history.state, '', `${location.pathname}${location.search}#${tab}`);
      } catch (err) {
        console.warn('Could not update the link', err);
      }
    }
    setTab(tab);
  }

  // The link carries the tab, the comparison and the open map, so any view
  // can be shared as is.
  function updateUrl() {
    const url = formatViewerUrl(state, location);
    try {
      history.replaceState(history.state, '', url);
    } catch (err) {
      console.warn('Could not update the link', err); // for example some file:// setups
    }
  }

  // ---- page ----

  const ctx = {
    el,
    svgEl,
    pct,
    clamp8,
    roundRgb,
    anchorPopover,
    VIEWS,
    RATING_COLS,
    GLYPH,
    PILL,
    data,
    state,
    items,
    mapByName,
    root,
    base,
    viewData,
    metrics,
    sepOf,
    rev,
    isRev,
    ratingPills,
    ratingCells,
    updateUrl,
    goTab,
    // Late bound: the modules call each other through these.
    setCompared: (name: string, on: boolean) => compare.setCompared(name, on),
    onCompareChange: () => {
      syncTabs();
      detail.syncCompare();
    },
    openDetail: (name: string) => detail.open(name),
    recolorFigure: (file: File, line?: unknown) => {
      goTab('recolor');
      recolor.open(file, line);
    },
    showRow: (name: string, opts?: { smooth?: boolean }) => browse.showRow(name, opts),
    detail: null, // set below
    compare: null,
  } as unknown as CmapViewerContext; // the strips members are added just below
  // Each module adds what it shares; later modules use what earlier ones added.
  Object.assign(ctx, setupCmapStrips(ctx));
  Object.assign(ctx, setupCmapPlots(ctx));
  Object.assign(ctx, setupCmapFooter(ctx));
  // Builds the rows, which number the references in list order.
  const browse = setupCmapBrowse(ctx);
  Object.assign(ctx, { headerRow: browse.headerRow, applyStripView: browse.applyStripView, buildRow: browse.buildRow });
  const detail = setupCmapDetail(ctx);
  const compare = setupCmapCompare(ctx);
  const identify = setupCmapIdentify(ctx);
  const recolor = setupCmapRecolor(ctx);
  const cvd = setupCmapCvd(ctx);
  Object.assign(ctx, { detail, compare });

  root.replaceChildren();
  const inner = el('div', { class: 'cmap-inner' });
  inner.append(el('h1', {}, 'Colormaps'));
  inner.append(
    el(
      'p',
      { class: 'cmap-intro' },
      `The ${data.maps.length} colormaps of Matplotlib, CMasher, Crameri’s Scientific colour maps, cmocean, colorcet, seaborn, CarbonPlan, NCL, SciVisColor, CARTOColors, MATLAB and R packages as seen, as simulated for three kinds of color-vision deficiency, and in grayscale, rated for uniformity, CVD and grayscale safety, and how well values can be read back. Hover a strip for its values; click to copy the hex.`,
    ),
  );
  // Tabs, controls and column names share one sticky bar, so they stay
  // readable while scrolling instead of one floating header per section.
  const top = el('div', { class: 'cmap-top' });
  top.append(buildTabs(), browse.bar, browse.header);
  const footer = ctx.buildFooter();
  inner.append(top, browse.list, compare.sec, identify.sec, recolor.sec, cvd.sec, footer);
  root.append(inner, detail.drawer, compare.tray);
  browse.anchorPopovers();

  // Links into the footer open it first, so the target is visible.
  root.addEventListener('click', (e) => {
    if ((e.target as Element).closest?.('a[href^="#ref-"], a[href="#cmap-about"]')) footer.open = true;
  });
  window.addEventListener('hashchange', () => {
    const r = parseViewerRoute(location.search, location.hash, names);
    if (r.tab) setTab(r.tab);
    else if (/^#(ref-|cmap-about)/.test(location.hash)) footer.open = true;
  });

  browse.applyStripView(root);
  compare.syncButtons();
  compare.render();
  syncTabs();
  setTab(route.tab || 'browse', { scroll: false });
  // Every history entry gets its tab, so Back returns to the right one.
  if (!location.hash) {
    try {
      history.replaceState(history.state, '', `${location.pathname}${location.search}#${state.tab}`);
    } catch {
      /* file:// */
    }
  }
  if (route.map) browse.showRow(route.map, { smooth: false });
  keepPlaceOnResize({ root, top, state, detail });
  browse.precomputeMetrics();
  return {
    items,
    setReversed(v: unknown) {
      state.reversed = !!v;
    },
  };
}

export function showStartupError(err: unknown) {
  console.error(err);
  const e = document.createElement('div');
  e.setAttribute('role', 'alert');
  e.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:99;padding:10px 14px;background:#b3261e;color:#fff;font:14px system-ui,sans-serif';
  e.textContent = `The colormap viewer could not start (${(err as Error)?.message || err}). Try a hard refresh (Ctrl+Shift+R). If it persists, report the first error in the browser console.`;
  document.body.prepend(e);
}

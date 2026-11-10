# React UI

How the colormap viewer's UI is built since the React migration (branch `react`, October 2026). Read this before changing the viewer. Typing rules are in [typescript.md](typescript.md); the visual UI standard is in CLAUDE.md.

React 19 renders the whole page. Strips, plots, the tooltip and the figure canvases stay imperative and are hosted by components through refs (see *What stays imperative*).

## The page

`src/pages/colormaps.ts` renders `<ColormapsApp/>` (`src/colormaps/app/colormaps-app.tsx`) into `#cmap-root` of `index.html`. A render error shows the startup banner (`onUncaughtError`, `showStartupError`).

- **State**: one reducer, `app/viewer-state.ts` (pure, tested): `{tab, open, compare, compareFlipped, reversed, flipped, stripView, sort, query, filters, reveal, history}`. State and dispatch have separate contexts (`app/viewer-context.ts`). Compare's table sort and the sine pattern stay local. Identify hands a `File` to Recolor through shell state with an id counter, not the reducer. The strip view is remembered in localStorage (`colormeris.cmapView`).
- **URL** (`app/use-url-sync.ts`): the link format is `?map=`, `?compare=` and `#tab` (`route.ts`: `parseViewerRoute`, `formatViewerUrl`). Tab changes from code push a history entry; everything else replaces. `hashchange` / `popstate` dispatch `ROUTE_FROM_URL`, which returns the same state when nothing changed, so there are no write loops. `#ref-…` and `#cmap-about` open the footer. `colormaps.html` is only a redirect to `./` that keeps the query and the hash.
- **Derived data**: `library-cache.ts` caches `base`, `viewData`, `metrics`, `notesOf` and `sepOf` per map at module level (colormap data never changes, so `memo` keyed on maps is fine). `app/ref-numbers.ts` numbers the references once. The color science itself comes from the `colormeris` package (`packages/core`).
- **Browse** (`app/browse/`): 1063 rows. `browse-model.ts` (pure) builds the tree, sorts and filters. A `Row` gets primitive props only (`name`, `index`, `compared`, `open`, `inline`, `forceBuild`, `dispatch`) and starts as a shell; one shared IntersectionObserver (`use-row-visible.ts`) builds it when it nears the view. Reversed, flips, strip view and the compare cap reach built rows through `RowViewContext`, so a global toggle renders only built rows. Search sets `hidden` on the rows' DOM in a layout effect (React never renders `hidden` on `.cmap-item`), so a keystroke renders no rows. Sections are uncontrolled `<details>`; their open state is restored after a search.
- **Detail** (`app/detail/`): one `DetailBody`, in the drawer when the window is at least 1200 px wide (`useMediaQuery`), else inline under its row. Folds are kept in a module store (`detail-folds.ts`) because the move remounts the body. Escape closes unless `defaultPrevented`, inside a field or with a popover open; focus returns to the row button (`focus-registry.ts`).
- **Scroll anchor** (`scroll-anchor.ts` + `app/use-scroll-anchor.ts`): saves the reader's place on scroll; on resize it freezes, flips `wide` with `flushSafely` (`src/ui/flush.ts`), then re-finds the saved anchor in the new detail and aligns it.
- **Tabs**: `app/compare/`, `identify/`, `recolor/`, `cvd/`, each a component with its pure model next to it. Shared pieces in `app/shared/`: `Strip`, `ProbeStrip`, `SvgFigure` (wraps the `plots.ts` builders), `FigureInput`, `RatingPills` / `RatingCells`, `TooltipProvider` (one imperative tip element). `map-picker.tsx` is the ARIA combobox of Compare and Recolor; `mountMapPicker` mounts it outside React.

## Patterns

- **Read in render, write in handlers.** Components read the reducer state during render and change it only through `dispatch`. Never dispatch during a render.
- **`flushSafely`** (`src/ui/flush.ts`): `flushSync` that refuses to nest; it returns `false` when it did not run, and the caller then renders normally. Use it where imperative code needs the DOM current right away (the scroll anchor, `mountMapPicker`).
- **Render budget**: a keystroke in the search or a global toggle must not render all 1063 rows. Keep row props primitive and pass shared view settings by context.
- **Tests** (`*.test.tsx`, `// @vitest-environment jsdom`, `afterEach(cleanup)` because Vitest has no globals) render under `<StrictMode>`. Browse tests use the IntersectionObserver stand-in in `src/testing/intersection-observer.ts`.

## What stays imperative

Strip canvases, SVG plots, the tooltip, Compare's drag-reorder and sine canvases, the Recolor and CVD canvases, and the scroll-anchor maths.

A component hosts these through a ref and draws in a layout effect. Never let React and imperative code write the same attribute or class of one element.

## Performance

`npm run perf` (`scripts/perf/run.mjs` + `bench.js`, after `npm run build`) serves the build on port 8006, runs it in headless Chrome (system Chrome, `CHROME_PATH` to override) and prints medians: load, Reversed toggle, sort, search and tab switches. `PERF_OUT=<dir>` measures another build, for an A/B against main (`git worktree add <dir> main`, then `vite build --outDir <out>` there). Numbers are only comparable on one machine. The bench relies on `.cmap-row`, `.cmap-th[data-sort]`, `.cmap-search` and the label text "Reversed".

Budget (user decision 2026-10-28): interactions within +10% of main, or within 2 ms when main is under 20 ms; no more long tasks; page load may grow by React's fixed cost only (about 16 ms, 69 KB gzip).

A/B of the React migration (2026-10-29, headless Chrome, ms, medians of 7; the pre-React build vs React):

| Measure | before | React |
| --- | --- | --- |
| load (loadEventEnd), 1063 rows | 82–85 | 73–78 |
| Reversed toggle | 0.1 | 0.5 |
| sort click | 17.1 | 16.6 |
| search "vir" and clear | 26.6 | 27.2 |
| tab switches (Compare, Identify, Recolor, Browse) | 10.1–10.8 | 9.2–9.6 |

Known bench artifact: `tab_cvd` reads ~6 ms over main because the first show's async example load spills into the next runs; measured directly, the example is ready ~49 ms after the switch on both builds.

## Pitfalls

- Focus and caret loss: stable keys, no components defined inside components.
- Event order: React handlers sit at the root, so element-level native listeners fire first and document `keydown` listeners after React; `stopPropagation` in React stops the document listeners.
- StrictMode runs effects twice in dev: every listener, observer and idle loop needs a cleanup.

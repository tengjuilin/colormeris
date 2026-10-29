# React UI

How the UI is built since the React migration (branch `react`, October 2026). Read this before changing a sidebar card, the Agent card, Settings or the colormaps page. Typing rules are in [typescript.md](typescript.md); the visual UI standard is in CLAUDE.md.

React 19 renders the cards and the colormaps page. The canvas viewer, overlays, results tables, plots and strips stay imperative and are hosted by components through refs (see *What stays imperative*).

## Extract page: the bridge

The workspace (`src/extract/workspace/workspace.ts`) keeps the project and mutates it in place. React learns about changes through a version counter, `src/extract/workspace/store.ts`:

- `notify({light})` bumps the version and runs the subscribers. It is called at the end of `renderSidebar` (so `changed()`, `commit`, undo/redo, `ws.render()` and the agent API all reach it), in `setMode`, in `setTool` (after switching) and on settings changes.
- **Full changes flush synchronously** (`flushSafely` in `src/ui/flush.ts`: `flushSync`, never nested; deferred to a microtask when a flush is already running). Imperative callers such as the agent API and `focusTick` expect the DOM to be current when `changed()` returns.
- **Light changes** (`changed({light: true})`: every keystroke in a number field, every pointermove of a handle drag) do not flush; React batches them in a microtask. No imperative caller reads the sidebar DOM after a light change.
- `fullVersion` is bumped by full changes only, for cards that ignore typing and drags.

`useWorkspace({section, light})` (`src/extract/react/use-workspace.ts`) subscribes to the version and returns `{ws, w}`. Components read `w.activePanel()`, `app.mode` and friends during render. While the card's section is hidden, the snapshot is frozen, so hidden tool cards cost nothing and re-render once when shown. `useWorkspaceContext()` returns `{ws, w}` without subscribing.

Because project objects are mutated in place:
- no `memo` or `useMemo` keyed on project objects (their identity never changes); key on primitives such as `panel.id` or a tick id;
- no React Compiler (it assumes immutability);
- `ws.resultFor` is cached, so calling it in render is cheap.

**Mounting.** `extract.html` keeps each `<section class="card" id="sec-…" hidden>` shell. `ws.mountCards()` (`src/extract/react/mount-cards.tsx`, `CARD_REGISTRY`) creates one root per section, in StrictMode, with the workspace and settings contexts. Each card is wrapped in `WhenShown`: it renders nothing until its section is first visible, then stays mounted, so `<details>` state and drafts survive tool switches. The workspace owns the section's `hidden`; React owns its children. Every id, `data-hotkey` and `data-icon` stays, because hotkeys, `focusTick`, the labels reader and the agent card find elements by them.

## `src/ui/` components

They render the classes of the UI standard in `base.css`, so a card cannot drift from it:

| Component | Renders |
| --- | --- |
| `Btn` (`variant`, `icon`, `hotkey`, `noCap`, `pressed`, `block`) | `.btn`; `pressed` sets `.active` + `aria-pressed`; `hotkey` sets the key cap and title through `hotkeyTitle` (`settings.ts`) and `data-react`, so `updateTitles` leaves it alone |
| `MainStep`, `IconBtn` | the card's `.btn.block` main step; `.btn.icon-only` with `title` + `aria-label` |
| `Card`, `CardHead`, `Badge` | card head with title, tag, status badge, head actions |
| `Fields`, `Field` (`as="div"` for non-label rows), `InputPair`, `Actions` / `SplitActions` | the field grid and action rows |
| `Check`, `Chip` / `ChipList`, `Options` (controlled `open`) | checkboxes, selectable chips, `details.options` |
| `Hint`, `Notice` | render nothing when empty |
| `BoundInput`, `BoundSelect`, `parseNumber` | keep a draft while focused (the caret survives, `""` and `"1."` are not reset), commit on the native `change` event |
| `SecretInput` | uncontrolled, so an API key never lands in the `value` attribute |
| `SettingsProvider` / `useSettings` | settings snapshot with its own counter |

`useBoundText` / `useBoundNumber` (`src/extract/react/use-bound.ts`) wire a `BoundInput` to the workspace: history is pushed on the first input of a focus session (focus and blur alone add none), each input applies with a light change, and `change` ends with `changed()`.

## The card pattern

Every extract card follows `src/extract/workspace/cards/panels-card.tsx`.

- **Read in render, write in handlers.** Read with `useWorkspace(...)`; keep no local copy of project state. Handlers read live state again (`const panel = w.activePanel()`), because they also run from hotkeys, `.click()` and after light changes. A handler mutates through workspace logic or `w.commit(...)` and ends with `w.changed()`. Never call `changed()` during a render or an effect.
- **Fields** bound to the active panel take `key={active.id}`, so a draft never carries over to another panel.
- **Focus after an action**: set a ref flag before the action; a `useLayoutEffect` focuses the element after the render that shows it and resets the flag in `finally`. Don't focus straight after `changed()`, since `notify` may defer.
- **Tool cards** check `panel.tool` (not `w.tool()`) before reading a result: during a tool switch a render can run while the active panel already belongs to the new tool. Tell results apart by shape (`'error' in res`, `Array.isArray(res.rows)`).
- **Render budget**: every light notify re-renders every visible light-subscribed card, so a render is O(panels) or O(ticks) at most, with no pixel work; canvases draw in layout effects keyed on what they show.
- **Tests** (`*.test.tsx`, `// @vitest-environment jsdom`, `afterEach(cleanup)` because Vitest has no globals) render under `<StrictMode>` with a fake `{ws, w}` around `createProject()` (set `app.sourceCanvas`) and assert the mutation, the history entries and the DOM.

Tool contexts reach the cards through small modules: `roi/cards/roi-context.ts` (`rctx`), `map/cards/map-context.ts` (`mctx`). The Agent card keeps its run state in a reducer (`agent/ui/agent-state.ts`) fed by runner callbacks.

## Colormaps page

`src/pages/colormaps.ts` renders `<ColormapsApp/>` (`src/colormaps/app/colormaps-app.tsx`) into `#cmap-root`; `colormaps.html` is unchanged. A render error shows the startup banner (`onUncaughtError`).

- **State**: one reducer, `app/viewer-state.ts` (pure, tested): `{tab, open, compare, compareFlipped, reversed, flipped, stripView, sort, query, filters, reveal, history}`. State and dispatch have separate contexts (`app/viewer-context.ts`). Compare's table sort and the sine pattern stay local. Identify hands a `File` to Recolor through shell state with an id counter, not the reducer.
- **URL** (`app/use-url-sync.ts`): the link format is `?map=`, `?compare=` and `#tab` (`route.ts`: `parseViewerRoute`, `formatViewerUrl`). Tab changes from code push a history entry; everything else replaces. `hashchange` / `popstate` dispatch `ROUTE_FROM_URL`, which returns the same state when nothing changed, so there are no write loops. `#ref-…` and `#cmap-about` open the footer.
- **Derived data**: `library-cache.ts` caches `base`, `viewData`, `metrics`, `notesOf` and `sepOf` per map at module level (colormap data never changes, so `memo` is fine here, unlike in extract). `app/ref-numbers.ts` numbers the references once.
- **Browse** (`app/browse/`): 1063 rows. `browse-model.ts` (pure) builds the tree, sorts and filters. A `Row` gets primitive props only (`name`, `index`, `compared`, `open`, `inline`, `forceBuild`, `dispatch`) and starts as a shell; one shared IntersectionObserver (`use-row-visible.ts`) builds it when it nears the view. Reversed, flips, strip view and the compare cap reach built rows through `RowViewContext`, so a global toggle renders only built rows. Search sets `hidden` on the rows' DOM in a layout effect (React never renders `hidden` on `.cmap-item`), so a keystroke renders no rows. Sections are uncontrolled `<details>`; their open state is restored after a search.
- **Detail** (`app/detail/`): one `DetailBody`, in the drawer when the window is at least 1200 px wide (`useMediaQuery`), else inline under its row. Folds are kept in a module store (`detail-folds.ts`) because the move remounts the body. Escape closes unless `defaultPrevented`, inside a field or with a popover open; focus returns to the row button (`focus-registry.ts`).
- **Scroll anchor** (`scroll-anchor.ts` + `app/use-scroll-anchor.ts`): saves the reader's place on scroll; on resize it freezes, flips `wide` with `flushSync`, then re-finds the saved anchor in the new detail and aligns it.
- **Tabs**: `app/compare/`, `identify/`, `recolor/`, `cvd/`, each a component with its pure model next to it. Shared pieces in `app/shared/`: `Strip`, `ProbeStrip`, `SvgFigure` (wraps the `plots.ts` builders), `FigureInput`, `RatingPills` / `RatingCells`, `TooltipProvider` (one imperative tip element). `map-picker.tsx` is the ARIA combobox also used by the Colorbar card.

## What stays imperative

- Extract: the viewer, overlays and `interact.ts`; the mode, view and status bars (updated on every pointer move); toast, empty state, dropzone and top bar; the results tables (up to 1000 × 1000 cells, hover highlight `td.hl`); the profile plot and the sweep (writes through refs each frame, no notify); the colorbar strip.
- Colormaps: strip canvases, SVG plots, the tooltip, Compare's drag-reorder and sine canvases, the Recolor and CVD canvases, the scroll-anchor maths.

A component hosts these through a ref and draws in a layout effect. Never let React and imperative code write the same attribute or class of one element.

## Performance

`npm run perf` (`scripts/perf/run.mjs` + `bench.js`) runs the built pages in headless Chrome (system Chrome, `CHROME_PATH` to override) and prints medians: extract load, an agent batch of 20 actions, 100 keystrokes in `#grid-rows`, undo; colormaps load, Reversed toggle, sort, search and tab switches. `PERF_OUT=<dir>` measures another build, for an A/B against main (`git worktree add <dir> main`, then `vite build --outDir <out>` there). Numbers are only comparable on one machine. The bench relies on `#grid-rows`, `.cmap-row`, `.cmap-th[data-sort]`, `.cmap-search` and the label text "Reversed".

Budget (user decision 2026-10-28): interactions within +10% of main, or within 2 ms when main is under 20 ms; no more long tasks; page load may grow by React's fixed cost only (about 16 ms, 69 KB gzip).

Final A/B (2026-10-29, headless Chrome, ms, medians of 7; main's build vs this branch):

| Measure | main | react |
| --- | --- | --- |
| extract load (loadEventEnd) | 80.0 | 94.5 |
| extract agent batch of 20 actions | 80.3 | 84.6 |
| extract 100 keystrokes in `#grid-rows` | 422.1 | 419.7 |
| extract undo | 8.1 | 7.7 |
| colormaps load (loadEventEnd), 1063 rows | 82–85 | 73–78 |
| colormaps Reversed toggle | 0.1 | 0.5 |
| colormaps sort click | 17.1 | 16.6 |
| colormaps search "vir" and clear | 26.6 | 27.2 |
| colormaps tab switches (Compare, Identify, Recolor, Browse) | 10.1–10.8 | 9.2–9.6 |

Extract counts 11 long tasks against 10 on main, but the total time in long tasks is lower: main runs the figure open and the first agent batch as one 250 ms task, which the faster React build splits in two. Known bench artifact: `tab_cvd` reads ~6 ms over main because the first show's async example load spills into the next runs; measured directly, the example is ready ~49 ms after the switch on both builds.

## Pitfalls

- Focus and caret loss: stable keys, no components defined inside components, `BoundInput` for fields.
- Event order: React handlers sit at the root, so element-level native listeners fire first and document `keydown` hotkeys after React; `stopPropagation` in React stops the document hotkeys.
- StrictMode runs effects twice in dev: every listener, observer and idle loop needs a cleanup.
- React 19 writes a controlled input's value to its `value` attribute: never use a controlled input for a secret (`SecretInput`).

# React migration: design (branch `react`)

Working design for moving the UI to React. Agents doing a migration step read this first. Once the migration is done, the lasting rules move to docs/typescript.md and CLAUDE.md, and this file is deleted.

## 1. How rendering is triggered today, and the bridge

**Today.** There is one entry point: `renderSidebar(light)` in `workspace.ts`. It toggles `hidden` on the section ids (`sec-panels`, `sec-grid`, `sec-colorbar`, `tool.sections`, `sec-agent`) and on the topbar buttons. Then it calls `w.renderPanels` (skipped when `light`), `w.renderGridCard`, `w.renderColorbarCard` and `tool.renderSidebar(panel, light)` (heatmap-tool, roi-sidebar, map/sidebar). It is reached from:
- `changed({light})`, which also redraws the viewer and calls the `ws.onChange` listeners (agent-card). `commit` (history.ts), undo/redo `restore`, panels.ts, interact.ts drags, api.ts and the tools all go through `changed`.
- `ws.render()`, called once from `pages/extract.ts`.

Some updates **bypass** `changed`:
- `setMode` calls `setPressed` on `grid-place`, `bar-place` and `tick-add`; roi-tool and map-tool call it on their own buttons. The mode bar is updated separately.
- `setTool({quiet})`.
- `app.tableCell` and `hoverCell` only redraw the viewer.
- `scheduleBarMatch` is async.
- `labels-reader` sets `dataset.busy`.
- agent-card keeps its own run state (log, status, review).
- `settingsUi` listeners (`updateTitles`, `applyCssColors`, agent-card) run on settings changes.
- `renderPanels` is also called on `panel-name` input.

**Bridge** (new `src/extract/workspace/store.ts`, set up in `workspace.ts`):

```ts
let version = 0; const subs = new Set<() => void>();
export const store = {
  subscribe: (fn: () => void) => (subs.add(fn), () => subs.delete(fn)),
  getVersion: () => version,
};
export function notify() { version++; flushSync(() => { for (const fn of subs) fn(); }); }
```

Bump `version` (call `notify()`) in these four places:
1. At the end of `renderSidebar`. This covers `changed`, `commit`, undo/redo, `ws.render` and the API.
2. In `setMode`, after `app.mode` is set.
3. In `setTool`, after `tool` is assigned. The quiet path needs it too.
4. In a `settingsUi.onChange` listener added in `pages/extract.ts`.

The `flushSync` matters. Imperative callers such as `focusTick(id)` after a commit, and the agent API reading the DOM expect the DOM to be current when `changed()` returns. Without it, React would flush in a microtask. Never call `changed()`/`commit` during a React render or effect, only from event handlers. `flushSync` warns there.

**Snapshot = the version number.** Project objects are mutated in place, so a selector that returns objects would either be stale or loop forever. Use the version like this:

```ts
export function useWorkspace() {           // src/extract/react/use-workspace.ts
  const ctx = useContext(WsContext)!;      // { ws, w }
  useSyncExternalStore(store.subscribe, store.getVersion);
  return ctx;                              // components read w.activePanel(), w.tool(), app.mode during render
}
```

Rules that follow from this:
- No `React.memo` or `useMemo` keyed on project objects; their identity never changes. Key on `version`, or on primitive keys such as a tick id or `panel.id`.
- Do **not** enable the React Compiler. It assumes immutability.
- `resultFor` is already cached, so calling it during render is cheap.
- `useSettings()` subscribes to `settingsUi.onChange` with its own counter.
- Keep StrictMode on in dev, since renders are pure.

## 2. Static HTML → components without breaking `$('id')`

- **Mount points.** Keep each `<section class="card" id="sec-…" data-tool=… hidden>` shell in `extract.html` and empty its children. `createRoot(section)` renders the card body into it. The workspace keeps owning the section's `hidden` attribute (`renderSidebar`, `setTool`); React owns only the children.
- **Keep every id**, `data-hotkey` and `data-icon` exactly as they are on the React elements. These read ids:
  - `setMode`: `grid-place`, `bar-place`, `tick-add`.
  - hotkeys.ts: `$('bar-place').click()`, `pdf-controls`, `mode-done`.
  - interact `focusTick`: `tick-list tr[data-id]`.
  - labels-reader: `grid-read-labels`, `-hint`.
  - agent-card: `agent-*`, `#sec-agent [data-mode]`, and `agent-labels`, which sits in the Grid card and uses `list="agent-llm-list"` from the Agent card.
  - roi-tool / map-tool / sweep `setPressed`: `tool-ellipse`, `tool-rect`, `tool-polygon`, `scale-place`, `axis-x-add`, `axis-y-add`, `profile-add`, `profile-sweep`.
  - updateTitles: every `[data-hotkey]`.
- **When to mount.** Add `ws.mountCards()`, a closure over `w` built in `createWorkspace`, so cards reach private members such as `applyDetectedSize` and `focusTick`. Call it in `pages/extract.ts` after `setupHeatmapTool`, `setupRoiTool`, `setupMapTool` and `ws.setTool(...)`, and before `ws.render()`, `createAgentApi` and `setupAgentPanel`. It renders inside `flushSync`, so the ids exist before any later imperative setup or call. Panels and tools exist by then: `createProject` always has a panel.
- **One owner per element.** A step that migrates a card also deletes that card's imperative `addEventListener`, `setPressed`, `setValue` and `textContent` lines in the same commit. Leftover external callers get `$('x')?.` guards or are removed.
- **No `data-tool` inside React.** `setTool` sets `hidden` on `[data-tool]` imperatively, and a remount would drop it. Components read `w.tool().kind` and use the `hidden={kind !== 'heatmap'}` prop. They hide instead of unmounting, which keeps `<details>` open state as today.
- **Hotkey titles.** Extract the body of `updateTitles` into a pure `hotkeyTitle(base, combos, label) → {title, key}` in `settings.ts`, with a unit test. `Btn` with `hotkey="grid" title="Shortcut: {key}"` renders `data-hotkey`, `data-title`, `data-key` and `title` from `useSettings()`. `updateTitles` writes the same values, so the two never fight. Remove `updateTitles` once no static `[data-hotkey]` is left (topbar and viewbar stay static, so it stays).

## 3. `src/ui/` component API (same CSS classes)

| Component | Props | Renders |
|---|---|---|
| `Card` | `id?`, `children` | fragment (the section is the mount) |
| `CardHead` | `title: ReactNode`, `tag?`, `badge?: {text, ok}`, `actions?: ReactNode` | `.card-head` h2, `.tag`, `.badge ok/todo` right after the title, `.head-actions` |
| `Btn` | `variant?: 'default'\|'primary'\|'danger'\|'subtle'`, `icon?`, `hotkey?`, `noCap?`, `pressed?`, `block?`, `type='button'`, plus button attributes | `.btn` + variant + `.block`; `data-icon`; `.active` + `aria-pressed` when `pressed !== undefined`; hotkey attributes (§2) |
| `MainStep` | `Btn` props | `Btn block` (`primary` given explicitly per CLAUDE.md) |
| `IconBtn` | `icon`, `label` (title + aria-label), `variant?` | `.btn.icon-only` |
| `SplitActions` / `Actions` | `children` | `.card-actions.split` / `.card-actions` |
| `Fields` | `children` | `.fields` |
| `Field` | `label`, `title?`, `stack?`, `children` | `label.field` (`.stack` for textareas) |
| `InputPair` | `children` | `.input-pair` |
| `Check` | `label`, `checked`, `onChange`, `title?` | `label.check` |
| `Chip` | `pressed`, `onClick`, `title?`, `dot?`, `meta?`, `children` | `button.chip` with `.chip-label` and `.chip-meta` |
| `ChipList` | `children` | `ul.chip-list`, each child in an `li` |
| `Badge` | `text`, `ok` | `.badge ok\|todo` |
| `Options` | `summary`, `note?`, `children` | `details.options`, `.summary-note`, `.options-body` (uncontrolled `open`) |
| `Hint` / `Notice` | `children`, `id?` | `.hint` / `.notice`; render nothing when empty, matching the collapsing CSS |
| `BoundInput` | `value`, `onFocus`, `onInput(str)`, `onCommit(str)`, `kind`, input attributes | see below |

`BoundInput` keeps today's `setValue` and `bindNumber` behaviour:
- While focused, it holds a local draft string and ignores model updates. This stops `""` or `"1."` being reset, and the caret survives.
- On blur it shows the model value again.
- `onCommit` hangs on a native `change` listener attached through a ref, because React's `onChange` is the `input` event.

The workspace wrapper hooks are `useBoundNumber(apply)` and `useBoundText(apply)`. They push history on focus, apply on input followed by `changed({light: true})`, and call `changed()` on change.

## 4. Migration steps (each shippable; `npm run check`, then the preview)

0. **Tooling** (§6) and one trivial `.tsx` test. Verify that `npm run build` and the dev server are unchanged.
1. **`src/ui/*` and tests.** Nothing in the app uses them yet.
2. **Bridge.**
   - Add `store.ts`, `use-workspace.ts`, `useSettings`, `BoundInput`, `hotkeyTitle`, and `mountCards` with no cards yet.
   - Verify there is no behaviour change and `window.colormeris` works.
   - Risk: a `flushSync` warning if some `changed()` runs inside a React callback. There are none yet.
3. **Panels card.**
   - Files: `panels.ts` (keep `removePanel`, `isEmptyPanel`, `ensurePagePanel`; drop `renderPanels` and the `panel-*` listeners), `workspace.ts` (`renderPanels` is no longer called), new `workspace/cards/panels-card.tsx`, and `extract.html`.
   - Verify:
     - typing a name keeps the caret, and the chips update live;
     - +/trash, including the confirm and the "Clear" title on the last panel;
     - the new panel's name is focused and selected (a ref or effect after add);
     - other-pages chips;
     - status dots and titles, including review rejected;
     - undo after a rename.
4. **Grid card**, which absorbs the heatmap grid parts and the label reader UI.
   - Files: `grid-card.ts` and `heatmap-tool.ts` (`renderSidebar` keeps only the results), `labels-reader.ts` (export `readLabels()` plus a busy/hint state that calls `notify`), `agent-card.ts` (stop setting `agent-labels`; the card reads `settings.agent.labels`), `workspace.ts` (remove the `grid-place` `setPressed`).
   - Verify:
     - the G key cap and tooltip after rebinding in Settings;
     - pressed state on G and on Esc;
     - rows field: clear it and type 12;
     - pasting labels gives the "Set rows to N" confirm;
     - anchor switch, then mode;
     - plot area in Map (badge in px), Box names in ROI;
     - Detect is disabled for dots;
     - Read labels busy state.
5. **Colorbar card.**
   - Tick rows keyed by `tick.id`. `focusTick` keeps working through `tr[data-id] input` after the flushSync.
   - `bar-strip` canvas through a ref and `useLayoutEffect(drawBarStrip)`.
   - `createMapPicker` mounted imperatively in a ref host until the colormaps phase.
   - The `scheduleBarMatch` result goes into state and calls `notify`.
   - Remove the `bar-place` and `tick-add` `setPressed` calls.
   - Verify:
     - click-adding ticks moves focus to the new value;
     - Enter blurs;
     - % edits;
     - B/T hotkeys, including `$('bar-place').click()`;
     - known colormap path; scale select; strip hidden when empty.
6. **Heatmap Results card.**
   - The card is React, but the table stays imperative through a ref. Hover highlighting uses `td.hl`, and React would wipe imperative classes on re-render.
   - Verify CSV, Copy and hover on the table.
7. **ROI: Regions, Scale bar (shared `scale-bar.ts`, also used by Map), ROI Results.**
   - Remove `setPressed` from roi-tool lines 302–303.
   - Verify:
     - E/R/P toggles;
     - selecting and renaming a region;
     - Reset nudges;
     - Delete key;
     - metric select;
     - the scale with its unit.
8. **Map: Axes, Profiles, Map Results.** Do this after the parallel `map/sidebar/` split lands.
   - The profile plot canvas and the sweep stay imperative. The sweep updates `profile-sweep-at` every frame, so it writes through a ref and does not call `notify`.
   - Verify:
     - X/Y ticks;
     - shift-click multi-select;
     - sweep start, pause and stop;
     - profile CSV.
9. **Agent card.**
   - The log, review list and badge move into `useReducer`, fed by runner callbacks.
   - The mode toggle uses `pressed`.
   - The datalists are rendered.
   - `ws.onChange` is replaced by `useWorkspace`.
   - Verify with the mock SDK from CLAUDE.md: Stop, review Accept/Redo, and page range.
10. **Settings dialog.** First the hotkey editor and the color list (dynamic lists), then the panes. `<form method="dialog">` keeps the `type="submit"` close button.
11. **Colormaps page.** In order:
    - route and tabs shell;
    - `map-picker` (an ARIA combobox: a good fit for React);
    - figure input;
    - detail drawer;
    - Compare, Identify, Recolor and CVD controls.

    Strips, plots and the tooltip stay imperative through refs. Colormap data is immutable, so `memo` works there, unlike in extract.

**Risks across all steps:**
- Focus and caret loss. Use stable keys, never define components inside components, and use `BoundInput`.
- Imperative and React writes to `className` (`active`, `hl`) on the same element.
- Event order. React handlers sit at the root, so element-level native listeners fire first and document `keydown` hotkeys fire after React. `stopPropagation` in React does stop the document hotkeys.
- Tooltips written by `updateTitles` vs. React's `title` prop. Both use `hotkeyTitle`, so they agree.
- `$()` returning null for a missing id. `$` is cast to `DomEl` and throws on use.
- `changed()` from the agent API calling many sync renders in a row. This is the same cost as today.

## 5. Testing

- Component tests are colocated as `*.test.tsx` with `// @vitest-environment jsdom` on the first line. Use `@testing-library/react` (`render`, `screen.getByRole`) and `@testing-library/user-event`, with `node:assert/strict` as in the existing tests.
- Vitest has no `globals`, so RTL's auto-cleanup does not register. Add `afterEach(cleanup)` in each file.
- `src/ui` tests check:
  - classes and `aria-pressed`;
  - the `data-key`/`title` produced by `hotkeyTitle`;
  - that `BoundInput` keeps the draft while focused and that `onCommit` fires on change.
- Card tests use a fake `{ws, w}` and `store` around a `createProject()` panel. Fire events, then assert both the mutation and `pushHistory`.
- Browser behaviour is still checked in the preview, per CLAUDE.md.

## 6. Packages and configuration

Picked 2026-10-28, each at least 14 days old:

| Package | Version |
|---|---|
| `react` | 19.3.1 (2026-10-14; 19.3.0 from 2026-09-09 if a strict over-14-days rule applies) |
| `react-dom` | same as `react` |
| `@types/react` | 19.3.0 |
| `@types/react-dom` | 19.3.0 |
| `@vitejs/plugin-react` | 6.1.2 (peer `vite ^8`; the oxc transform, no babel) |
| `@testing-library/react` | 16.3.3 |
| `@testing-library/dom` | 10.4.2 (peer) |
| `@testing-library/user-event` | 14.6.8 |
| `jsdom` | 30.1.2 (30.1.3 is under 14 days old) |

Configuration changes:
- **`tsconfig.json`:** add `"jsx": "react-jsx"`. `include` already covers `src`.
- **`vite.config.ts`:** `plugins: [react()]`, and `test.include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts']` with the environment staying `node`.
- **`biome.jsonc`:** `"linter": { "domains": { "react": "recommended" } }`. This brings `useExhaustiveDependencies` and `useHookAtTopLevel`. `a11y/useButtonType` is satisfied by `Btn`'s default `type="button"`. `files.includes` (`src/**`) already covers `.tsx`.
- **`docs/typescript.md`:** add the React rules: version snapshot, no `memo` on project objects, `BoundInput`, `flushSync`.

## 7. What should not move to React

- **Stays imperative:**
  - the Viewer, overlays and `interact.ts`;
  - the mode bar, view bar and status bar (updated on every pointer move: a re-render per mousemove for nothing);
  - toast, the empty state, the dropzone and the top bar;
  - the results tables (heatmap up to 1000×1000, with an imperative hover highlight; a React card hosts them through a ref);
  - the profile plot and sweep animation, `bar-strip`, and colormap strips and plots;
  - `scroll-anchor`.
- **Little gain, do mainly for consistency:** Panels, Grid, Scale bar and Map Results. They are mostly fields that `setValue` already handles well.
- **Real gain:**
  - the Colorbar tick table and the ROI and Profile lists (keyed lists with inputs, today hand-diffed with `tickKey` and `roiListKey`);
  - the Agent card (log, review, run state);
  - the Settings hotkey and color editors;
  - colormaps' map picker, detail drawer and Compare controls.
- **Recommendation:** if effort is limited, do steps 0–3 (pattern), then 5, 7 (Regions), 8 (Profiles), 9 and 10. Leave Grid, Scale and the results cards imperative unless they block removing `bindNumber`/`setValue`.

## 8. Light changes and performance (amends §1)

- `changed({light: true})` fires on every keystroke in a number field and on every pointermove of a handle drag (`interact.ts`). For these, `notify()` does **not** use `flushSync`. React renders in a microtask, which batches every change from one event. No imperative caller reads the sidebar DOM after a light change.
- A full `changed()` keeps `flushSync`.
- A hidden card stays mounted but skips re-renders (§10), so hidden tool cards cost nothing.
- Ids, classes and `data-*` attributes stay identical. CSS, hotkeys and `scripts/perf/bench.js` depend on them:
  - extract: `#grid-rows`;
  - colormaps: `.cmap-row`, `.cmap-th[data-sort]`, `.cmap-search`, and the `Reversed` label.
- **Budget**, measured A/B against a build of `main`. Use the same machine and medians of 7 loads. Build main with `git worktree add <dir> main`, then run `vite build --outDir <out>`. Then run `PERF_OUT=<out> npm run perf` and `npm run perf`.
  - Agent batch, typing, undo, sort, search and tab switches each stay within +10%, or within 2 ms when the baseline is under 20 ms.
  - Long tasks are not more numerous.
  - Page load may grow by React's fixed cost only. That is about 16 ms and 69 KB gzip, measured in the bridge step. The user accepted it on 2026-10-28. App code beyond that stays within +10%.
  - An over-budget result blocks the commit.

A/B at the bridge step (2026-10-28, headless Chrome, total ms, median of 7):

| Measure | main | react branch |
| --- | --- | --- |
| extract load (loadEventEnd) | 74.1 | 90.0 |
| extract agent batch of 20 `set_tick_value` | 77.4 | 76.4 |
| extract 100 keystrokes in `#grid-rows` | 410.3 | 408.5 |
| extract undo | 7.8 | 7.5 |
| colormaps load (loadEventEnd), 1063 rows | 81.1 | 97.1 |
| colormaps sort click | 16.8 | 16.7 |
| colormaps search "vir" and clear | 21.7 | 16.9 |
| colormaps tab switches (each) | 9.2–9.6 | 9.3–9.7 |

Long tasks: 10 on extract (the figure load), 0 on colormaps, on both builds.

Gzip JS on main: extract 132.3 KB and colormaps 41.0 KB. The shared colormap-data chunk is 162.3 KB on main and 231.6 KB with React. pdf.js (129.0 KB) and the OpenRouter SDK (151.6 KB) are lazy.

## 9. Colormaps page (React state + URL; replaces §4 step 11)

**Mount and state**
- `src/pages/colormaps.ts` renders `<ColormapsApp/>` into `#cmap-root`. `colormaps.html` is unchanged.
- State lives in `src/colormaps/app/viewer-state.ts`, which is pure and tested.
  - Fields: `{tab, open, compare, compareFlipped, reversed, flipped, stripView, sort, query, filters, reveal, history}`.
  - Actions: `ROUTE_FROM_URL`, `GO_TAB`, `OPEN`, `SET_COMPARED` (enforces `COMPARE_MAX`), `MOVE_COMPARED`, `REORDER_COMPARED`, `TOGGLE_COMPARE_REV`, `SET_REVERSED`, `TOGGLE_FLIP`, `SET_STRIP_VIEW` (localStorage in an effect), `SORT` (cycles), `SET_QUERY`, `TOGGLE_FILTER`, `CLEAR_FILTERS`, `SHOW_ROW` (browse tab, clears filters hiding the map, opens it, sets `reveal`).
- State and dispatch use separate contexts. Compare's table sort, its column set and the sine pattern stay in local state. Identify passes "Recolor this" to Recolor through a ref inbox, because a `File` does not belong in the reducer.

**URL**
- The initial state is `initFromRoute(parseViewerRoute(location.search, location.hash, names))`. A missing hash is added with `replaceState`.
- `useUrlSync` writes `formatViewerUrl(state, location)`, a new pure function in `route.ts`. It uses `pushState` only for `GO_TAB` from code and `replaceState` otherwise, so `?map=` and `?compare=` changes add no history entries.
- Tab links stay `<a href="#x">`. A `hashchange` or `popstate` event dispatches `ROUTE_FROM_URL`. `#ref-…` and `#cmap-about` open the footer.
- Sort, reversed, flipped and strip view stay out of the URL.

**Derived data**
- `src/colormaps/library-cache.ts` holds module-level caches of `base`, `viewData`, `metrics`, `notesOf` and `sepOf`. They are safe because colormap data never changes. `isRev(state, name)` is a function.
- `references.ts` gets a pure `buildRefNumbers(maps)`, computed in default list order, which replaces the `refNumber` side effect.

**Files**
- `src/colormaps/app/` contains `ColormapsApp`, `TabNav`, `StickyTop`, `Footer`, and the hooks `useUrlSync`, `useScrollAnchor` and `useMediaQuery` (WIDE = min-width 1200px).
- `shared/`: `Strip` (canvas via ref), `TooltipProvider` (one imperative tip div), `SvgFigure` (calls `plots.ts` builders in a layout effect), `FigureInput`, `RatingPills`, `RatingCells`.
- `browse/`: `BrowseTab`, `BrowseControls`, `BrowseHeader`, `BrowseList`, `Section`, `Row`, `useRowVisible`.
- `detail/`: `DetailDrawer`, `DetailBody`, …
- `compare/`: `CompareTab`, `CompareTray`, …
- `identify/`, `recolor/` and `cvd/`.
- `src/colormaps/map-picker.tsx` exports `<MapPicker id label value onChoose/>`, an ARIA combobox that imports `cmapData` directly, plus `mountMapPicker(el, props) → {update, destroy}` for hosts that are not React yet.

**Browse list (performance)**
- Each of the 1000+ maps gets one keyed `React.memo` `<Row>` with primitive props only (`reversed`, `compared`, `open`, `stripView`, `hidden`) and the stable `dispatch`. Rows never read the state context.
- Rows start as shells. A shared IntersectionObserver (rootMargin 400px) builds them, as today's lazy build does. `useRowVisible(force)` lets `OPEN` and `reveal` force-build a row.
- Sorting and filtering are a memoised ordered and visible list.
- Sections are uncontrolled `<details>`.
- The idle metric precompute runs in an effect with `requestIdleCallback`.

**Imperative behind refs**
- Strip canvases, the tooltip and the SVG plots.
- Compare's drag-reorder and sine canvases, and the Recolor and CVD canvases.
- The scroll anchor: `createScrollAnchor({root, top}) → {save, freeze, restore}`. It freezes on resize, then restores in a `useLayoutEffect` keyed on `wide` after the drawer/inline move. Scroll saves are skipped between freeze and restore.

**Focus**
- A `Map<name, HTMLButtonElement>` ref registry returns focus to the row button.
- The Escape handler respects `defaultPrevented`, which the picker sets.
- `DetailBody`'s fold state is lifted to `DetailDrawer`, keyed by map name, because moving between drawer and inline remounts it.

**Steps**
- **11a (parallel):**
  - pure extraction (`library-cache`, `formatViewerUrl`, `viewer-state` with tests, `viewer.ts` uses them);
  - the React `MapPicker` and its three call sites (recolor-tab, compare-tab, colorbar-card);
  - shared wrappers (new files only).
- **11b:** CVD, Identify, Recolor, then Compare and the tray, as React islands mounted by the old `viewer.ts` with callbacks in place of `ctx`.
- **11c:** shell, reducer, URL sync, Browse, Detail and the scroll anchor. This deletes `viewer.ts`, the old tab modules and the islands.
- **11d:** delete `CmapViewerContext`, `CmapListItem`, `setupCmap*` and the `any` index.

## 10. The card pattern (from the Panels card, reviewed 2026-10-29)

Every extract card copies `src/extract/workspace/cards/panels-card.tsx`.

**Reading state**
- Read during render with `useWorkspace(...)`: `w.activePanel()`, `w.pagePanels()`, `w.toolFor(p)…`. Keep no memo and no local copy of project state.
- Values computed at render time are for JSX only. Handlers read live state (`const panel = w.activePanel()`), because handlers also run from hotkeys, `.click()` and after light (microtask) changes.

**Writing**
- A handler mutates through the existing workspace logic or `w.commit(...)` and ends with `w.changed()`, which flushes before it returns.
- Never call `changed()` during a render or an effect.

**Fields**
- A field bound to the active panel takes `key={active.id}`, so a draft never carries over to another panel.
- Use `BoundInput` or `BoundSelect` with `useBoundText` or `useBoundNumber`. The history entry is pushed on the first input of a focus session, not on focus. Focusing and blurring without typing adds no entry.

**Focus after an action**
- Set a ref flag before the action. A `useLayoutEffect` focuses the element after the render that shows it, and the flag is reset in `finally`.
- Do not focus straight after `changed()`: `notify` may defer to a microtask when a flush is already running.

**Tool cards**
- A tool's card checks `panel.tool` before computing or reading a result (`panel.tool === 'map' ? ws.resultFor(panel) : …`). Don't gate on `w.tool()`.
- During a tool switch a render can run while the active panel already belongs to the new tool.
- Tell results apart by their shape (`'error' in res`, `Array.isArray(res.rows)`), never by a field name another tool's result also has.

**Visibility**
- Cards stay mounted, so `<details>` open state and drafts survive a tool switch.
- `useWorkspace` with the card's section skips re-renders while the section is hidden, and re-renders once when it is shown again.
- Cards that don't need live updates during drags and typing subscribe to full changes only (`light: false`).

**Render budget**
- Every light notify, from a keystroke or a drag frame, re-renders every visible light-subscribed card.
- A render is O(panels) or O(ticks) at most, with no image or pixel work: results come only from `resultFor`'s cache, and canvases draw in layout effects keyed on what they show.

**Tests**
- Card tests render under `<StrictMode>` with a minimal `{ws, w}` around `createProject()`.
- They assert the mutation, the history entries and the rendered DOM.

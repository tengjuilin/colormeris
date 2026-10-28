# Converting to TypeScript

How each classic script in `assets/js/**` becomes a TypeScript ES module in `src/**`. The conversion is 1:1: same code, same comments, same exported names, now with types. Shared domain types are in `src/types/` (import them from `src/types/index.ts`). Check every file with `npx tsc`, `npx biome lint src` and `npx vitest run <test file>`.

## Ground rules

- **No behaviour changes.** No logic edits, no renames of exported names, no refactors. Typing may add annotations, casts, `!` after a check the code already makes, and `String(n)` where a DOM property wants a string. Anything bigger: leave a `// TODO(types)` and report it.
- **Files are already moved** to their new paths (rename-only commit `a39363c`), still holding the classic-script code; edit them in place. Do not commit.
- **Keep every comment**, including the header comment that says what the file does. Drop `'use strict'` (modules are strict) and the IIFE wrapper, and dedent the body by 2 spaces. Do not run `biome format` on converted files; formatting is a later, separate commit.
- `strict: true`. Pure modules (the ones `tests/load.js` imports) are fully typed: no `any`. UI code may use `any` at DOM seams only, marked `// TODO(types)`. Prefer `unknown` plus a check in pure code, `Record<string, unknown>` for open objects.
- `import type { … }` for types (`verbatimModuleSyntax`), always with the `.ts` extension: `import { rgbToLab } from '../core/color.ts'`.
- Out of scope for converters: the HTML pages, `package.json`, `scripts/`, CLAUDE.md, README.

## IIFE → module

```js
(function (CM) {                         // removed
  'use strict';                          // removed
  const { rgbToLab, readPixel } = CM;    // → import { rgbToLab } from '../core/color.ts';
                                         //   import { readPixel } from '../core/grid.ts';
  function sampleColorbar(img, …) { … }  // → export function sampleColorbar(img: PixelImage, …): ColorbarSample[] { … }
  Object.assign(CM, { sampleColorbar }); // removed: `export` at each declaration instead
})((globalThis.Colormeris ??= {}));       // removed
```

- Every name in `Object.assign(CM, {…})` becomes an `export` where it is declared (`export function`, `export const`). Names used only inside stay unexported.
- Lazy lookups `CM.x(…)` (decide.js, colorbar.js, project.js, project-files.js, colorbar-card.js and the colormap tabs) become plain imports of `x`.
- Aliased public names keep the public name. Rename the local declaration only where nothing else uses it, else add `export const PUBLIC = local;`:
  - schema.js `AGENT_ACTIONS: ACTIONS`
  - llm.js `AGENT_SYSTEM_PROMPT: SYSTEM_PROMPT`; `AGENT_LIMITS: { MAX_ATTEMPTS, MAX_ERRORS_IN_A_ROW, MAX_FINISH_REFUSALS }` → `export const AGENT_LIMITS = {…}`
  - decide.js `DECISION_SYSTEM_PROMPT: SYSTEM_PROMPT`, `decisionQuestions: questions`
  - colormap-match.js `cmapColorAt: colorAt`
  - metrics.js `READ_WINDOW: FLAT_WINDOW`, `CMAP_RATING: RATING`
  - references.js `CMAP_REFS: REFS`
- `CM.cmapCommon = {…}` (colormaps/common.js) → export each member; viewer.js imports them from `common.ts`.
- `CM.cmapData` → `import { cmapData } from '../core/colormap-library.ts'` (done: it loads `src/generated/colormap-data.json`). `CM.cmapData &&` guards become `cmapData &&` or are dropped where always true.
- `extract/main.js` becomes `src/pages/extract.ts`. The boot block at the end of `colormaps/viewer.js` (the `cmap-root` lookup) moves verbatim to `src/pages/colormaps.ts`; `viewer.ts` exports `setupColormapViewer` and `showStartupError`.
- Top-level code that ran at script load (workspace.js `resize` listener, hotkeys.js `isMac`) stays at module top level.

## Types to use

From `src/types/`: `Point`, `Box`, `Rgb`, `Lab`, `PixelImage` (ImageData-like; pure code takes this, not `ImageData`), `Project`, `Panel`, `Grid`, `Colorbar`, `Tick`, `TickWithT`, `Roi`, `ScaleBar`, `MapSettings`, `Profile`, `AxisTick`, `Review`, `SourceInfo`; results `HeatmapResult`, `RoiResult`, `MapResult`, `ColorbarSample`, `LabelledBin`, `PanelResult`, `ErrorResult`; `Settings`, `HotkeyAction`, `ColorItem`, `SettingsUi`; `Workspace`, `WorkspaceContext`, `ToolHooks`, `Mode`, `Handle`, `ViewerApi`, `DomEl`; agent `JsonSchema`, `ActionSpec`, `ActionResult`, `ColormerisApi`, `Question`, `Decision`, `ChatMessage`, `ChatClient`, `RunSettings`, `ToolCallResult`, `DecisionRequest`, `DecideFn`; `ColormapData`, `CmapViewerContext`. Globals (`window.JSZip`, `window.colormeris`, `globalThis.OpenRouterSDK`, `ColormerisPdfjsSource`, `pdfjsWorker`) are declared in `src/types/globals.ts`.

Types of one module only (a locate.js candidate, a decide.js plan, `fitCellCounts`' result) are declared in that module and exported if another module needs them. Let return types of pure functions be inferred unless a type above fits.

## Patterns

- **Results and `error`.** `if (res.error) return …` does not narrow (an empty string is falsy). After the check, cast: `const r = res as HeatmapResult;`.
- **Ticks** are one shape with optional `x`, `y`, `t` (the code tells them apart with `Number.isFinite(k.x)`, which does not narrow). Cast to `Point` where a page tick is passed on: `projectT(start, end, k as Point)`.
- **ROIs** are a union on `shape`; `if (roi.shape === 'polygon')` narrows. Functions taking `(shape, geom)` apart cast `geom as PolygonGeom` / `as ShapeGeom`.
- **Nullable values the code has already checked**: `cb.start!` after `colorbarProblem` passed, `makeValueFn(…)!` after `tickProblem` returned null, `grid.corners!` after `panelProblem`. Use `!` only where the JS relies on the same fact.
- **`$`** returns `DomEl` (an input and a select at once: value, checked, options, max). Cast for other kinds: `$('x') as unknown as HTMLCanvasElement`. `el.max = String(n)`.
- **Workspace modules** take the private context and return their members:

  ```ts
  import type { HistoryMembers, WorkspaceContext } from '../../types/index.ts';
  export function setupWorkspaceHistory(w: WorkspaceContext): HistoryMembers { … return { pushHistory, clearHistory, undo, redo, commit }; }
  ```

  `HistoryMembers` is `Pick<WorkspaceContext, 'pushHistory' | …>`; likewise `OverlayMembers`, `InteractMembers`, `GridCardMembers`, `ColorbarCardMembers`, `PanelsMembers`, `SourceMembers`, `ExportMembers`, `HotkeysMembers`. In `workspace.ts` build the core object as `WorkspaceCore`, then `const w = core as WorkspaceContext;` before the setup loop, and `const ws: Workspace = {…}`. If a module's real signature differs from `WorkspaceContext`, fix the type in `src/types/workspace.ts` (the code wins) and say so in the report.
- **Tool hooks**: `ws.addTool({…} satisfies ToolHooks)`. `computeResult` returns the tool's result type (assignable to `PanelResult`).
- **Tool contexts** `rctx` (roi-tool.js) and `mctx` (map-tool.js): declare `export interface RoiToolContext` / `MapToolContext` in roi-tool.ts / map-tool.ts; roi-overlay.ts, roi-sidebar.ts and map-sidebar.ts `import type` it (a type-only cycle is fine).
- **Colormap viewer `ctx`**: modules take `ctx: CmapViewerContext`; `setupX(ctx)` returns its members. Drop `CM` from the ctx literal in viewer.ts (no module reads `ctx.CM`). `createMapPicker` takes `Pick<CmapViewerContext, 'el' | 'data' | 'mapByName' | 'base' | 'stripCanvas'>`, because colorbar-card.js passes a small `pickerCtx`.
- **Viewer**: `export class Viewer implements ViewerApi`, with typed fields; the callbacks are `ViewerCallbacks`.
- **Libraries come from npm** (`package.json` pins the vendored versions; `assets/vendor/` is deleted):
  - JSZip: `import JSZip from 'jszip'` where `window.JSZip` was read; pure files keep taking `JSZip` as a parameter.
  - pdf.js: keep the lazy load, `const pdfjsLib = await import('pdfjs-dist')`, worker from `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'` → `GlobalWorkerOptions.workerSrc = workerUrl`. Remove the `file://` path (`pdf.embed.js`, `ColormerisPdfjsSource`, `pdfjsWorker`): the app is served by Vite now. Keep `FROM_DISK` exported only if other code reads it.
  - OpenRouter SDK: `loadOpenRouterSdk` keeps returning `globalThis.OpenRouterSDK` when a test or mock set it, else `await import('@openrouter/sdk')` (lazy chunk) and returns that module (it exports `OpenRouter`).
  - Example files moved to `public/examples/` and are served at `examples/…` (relative to the page): `assets/examples/x` → `examples/x`.
- **JSON Schemas** (schema.js `ACTIONS`, llm.js `RUNNER_TOOLS`, decide.js `DECISION_TOOLS`): `const ACTIONS: Record<string, ActionSpec> = {…}`. Schema pieces declared apart (`const point = { type: 'object', … }`) widen `'object'` to `string`: annotate them `const point: JsonSchema = …`.
- **Constants with literal unions** (`SCALES`, `KINDS`, `HOTKEY_ACTIONS`): annotate (`const SCALES: ColorbarScale[] = […]`) so `includes(x)` still takes a string: `(SCALES as string[]).includes(cb.scale)`.

## Tests

- `tests/<dir>/x.test.js` → next to the module as `src/<dir>/x.test.ts` (map below). `import { describe, test } from 'vitest'`; keep `import assert from 'node:assert/strict'`.
- Import the functions from their modules, not from `tests/load.js` (`const { a, b } = CM` → named imports). Helpers come from `src/testing/helpers.ts` (`tests/helpers.js` converted; it imports `invertBilinear` from `core/grid.ts`).
- openrouter-client.test.js: `t.mock.timers.enable({ apis: ['setTimeout'] })` → `vi.useFakeTimers({ toFake: ['setTimeout'] })`, `t.mock.timers.tick(ms)` → `vi.advanceTimersByTime(ms)`, `vi.useRealTimers()` at the end; stub `location` with `vi.stubGlobal` before a dynamic `await import('./openrouter-client.ts')`.
- docs.test.js is `scripts/agent-docs.test.ts` (the lead converts that script).
- Test values may need casts (`as Panel`); never change what a test checks.

## Path map

| Old | New |
| --- | --- |
| `assets/js/core/{color,cvd,grid,colorbar,locate,colormap-match,colormap-library}.js` | `src/core/<same>.ts` (+ `src/generated/colormap-data.json`) |
| `assets/js/extract/project.js`, `project-files.js` | `src/extract/project/project.ts`, `project-files.ts` |
| `assets/js/extract/settings.js`, `settings-dialog.js` | `src/extract/settings/settings.ts`, `settings-dialog.ts` |
| `assets/js/extract/{pdf-loader,viewer,scale-bar}.js` | `src/extract/<same>.ts` |
| `assets/js/extract/main.js` | `src/pages/extract.ts` |
| `assets/js/extract/workspace/*.js` (10 files) | `src/extract/workspace/<same>.ts` |
| `assets/js/extract/heatmap/{sampling,heatmap-tool}.js` | `src/extract/heatmap/<same>.ts` |
| `assets/js/extract/roi/{geometry,quantify,roi-tool,roi-overlay,roi-sidebar}.js` | `src/extract/roi/<same>.ts` |
| `assets/js/extract/map/{field,map-tool,map-sidebar}.js` | `src/extract/map/<same>.ts` |
| `assets/js/agent/{schema,llm,decide,decision-tools,labels,runner,api,openrouter-client}.js` | `src/agent/<same>.ts` |
| `assets/js/agent/{agent-card,labels-reader}.js` | `src/agent/ui/<same>.ts` |
| `assets/js/colormaps/{viewer,common,metrics,route,recolor,references,map-picker,figure-input,scroll-anchor,strips,plots,footer}.js` | `src/colormaps/<same>.ts` |
| `assets/js/colormaps/{browse-tab,detail-drawer,compare-tab,identify-tab,recolor-tab,cvd-tab}.js` | `src/colormaps/tabs/<same>.ts` |
| (boot block of `colormaps/viewer.js`) | `src/pages/colormaps.ts` |
| `tests/helpers.js` | `src/testing/helpers.ts` |
| `tests/core/<x>.test.js` | `src/core/<x>.test.ts` |
| `tests/extract/project.test.js`, `settings.test.js` | `src/extract/project/project.test.ts`, `src/extract/settings/settings.test.ts` |
| `tests/extract/sampling.test.js` | `src/extract/heatmap/sampling.test.ts` |
| `tests/extract/roi-geometry.test.js`, `quantify.test.js` | `src/extract/roi/geometry.test.ts`, `quantify.test.ts` |
| `tests/extract/map.test.js` | `src/extract/map/field.test.ts` |
| `tests/agent/{schema,llm,decide,labels,openrouter-client,docs}.test.js` | `src/agent/<same>.test.ts` |
| `tests/colormaps/{metrics,recolor,route}.test.js` | `src/colormaps/<same>.test.ts` |
| `tests/load.js` | deleted once nothing imports it (lead) |
| `tests/fixtures/` | `src/testing/fixtures/` (data written by `scripts/make-calibration.mjs`) |

Import paths follow the new layout: from `src/extract/roi/quantify.ts`, `../../core/color.ts`, `../project/project.ts`, `../heatmap/sampling.ts`, `../../types/index.ts`.

## Watch for

- Properties added after creation: `grid.autoSize` (agent/api, grid-card, interact), tick `id` (not saved; source.ts assigns ids after reading a zip), `project.source.sha256` and `pageCount`/`renderScale` set after open, `ws.settings` / `ws.reviewStatus` replaced later, `app.mode.done` / `mode.lim`, handle caches (`handle.dir`, `ts`, `len`, `from`). All are in the types; do not add them at creation.
- Number or null: grid corners, colorbar ends, `scale`, `review`, `source`, `colormap`; `alt` in `fitCellCounts`; `x`/`y`/`len` of profile samples; `pxArea`. Tick values are NaN when untyped in memory but `null` in JSON. `detectGridSize` confidences can be `Infinity`.
- `makeValueFn` returns `null` for unusable ticks; `labelBins`/`colorbarBins` return `null` for a smooth bar; `refineColorbar`, `snapTick`, `cellAt` return `null` when nothing is found.
- `color(id)` returns `string | string[]` (palettes); the `COLORS` getters and single colors cast `as string`, palettes `as string[]`.
- Two image-part spellings: the SDK takes `imageUrl` (runner.ts), the Decisions API `image_url` (decision-tools.ts). Keep both.
- `PixelImage` vs `ImageData`: pure code takes `PixelImage`; DOM code holds `ImageData` (assignable to it).

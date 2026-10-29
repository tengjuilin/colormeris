# TypeScript conventions

Colormeris is strict TypeScript in ES modules, bundled by Vite (see CLAUDE.md for the layout). The code was converted 1:1 from classic scripts in October 2026 (commits `a39363c`..`c278af4`; `git log --follow` reaches the old JS). These are the rules that conversion set, and they apply to new code. Check every change with `npm run check` (Biome lint, `tsc`, Vitest).

## Ground rules

- `strict: true`. Pure modules (no DOM: `src/core`, `project/`, `settings/settings.ts`, `heatmap/sampling.ts`, `roi/geometry.ts`, `roi/quantify.ts`, `map/field.ts`, agent `schema`/`llm`/`decide`/`labels`, colormaps `metrics`/`route`/`recolor`/`references`) are fully typed: no `any`. Prefer `unknown` plus a check, `Record<string, unknown>` for open objects. Untrusted JSON read field by field uses the one `Raw` alias in project.ts / settings.ts.
- No `any` anywhere: Biome's `noExplicitAny` is an error. A seam that really needs it (one options bag in `colormaps/figure-input.ts`) carries a `biome-ignore` with the reason; casts that the types can't express yet are marked `// TODO(types)`.
- `import type { … }` for types (`verbatimModuleSyntax`), always with the `.ts` extension: `import { rgbToLab } from '../core/color.ts'`.
- Every file starts with a comment saying what it does; comments explain why. Keep exported names stable: the agent API, docs/agent.md and tests use them.
- Libraries come from npm (pinned in `package.json`): `import JSZip from 'jszip'`; pdf.js is loaded lazily in `pdf-loader.ts`; the OpenRouter SDK is a lazy `import('@openrouter/sdk')` in `openrouter-client.ts`, which returns a pre-set `globalThis.OpenRouterSDK` first (mocks). Static files are in `public/` and are fetched relative to the page (`examples/example.pdf`).
- Formatting is Biome's; formatting-only changes go in their own commit.

## Types to use

From `src/types/`: `Point`, `Box`, `Rgb`, `Lab`, `PixelImage` (ImageData-like; pure code takes this, not `ImageData`), `Project`, `Panel`, `Grid`, `Colorbar`, `Tick`, `TickWithT`, `Roi`, `ScaleBar`, `MapSettings`, `Profile`, `AxisTick`, `Review`, `SourceInfo`; results `HeatmapResult`, `RoiResult`, `MapResult`, `ColorbarSample`, `LabelledBin`, `PanelResult`, `ErrorResult`; `Settings`, `HotkeyAction`, `ColorItem`, `SettingsUi`; `Workspace`, `WorkspaceContext`, `ToolHooks`, `Mode`, `Handle`, `ViewerApi`, `DomEl`; agent `JsonSchema`, `ActionSpec`, `ActionResult`, `ColormerisApi`, `Question`, `Decision`, `ChatMessage`, `ChatClient`, `RunSettings`, `ToolCallResult`, `DecisionRequest`, `DecideFn`; `ColormapData`. Globals (`window.JSZip`, `window.colormeris`, `globalThis.OpenRouterSDK`, `ColormerisPdfjsSource`, `pdfjsWorker`) are declared in `src/types/globals.ts`.

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
- **Tool contexts** `rctx` (roi-tool.js) and `mctx` (map-tool.js): declare `export interface RoiToolContext` / `MapToolContext` in roi-tool.ts / map-tool.ts; roi-overlay.ts, the cards in roi/cards/ and the cards in map/cards/ `import type` it (a type-only cycle is fine).
- **Viewer**: `export class Viewer implements ViewerApi`, with typed fields; the callbacks are `ViewerCallbacks`.
- **Libraries come from npm** (`package.json` pins the vendored versions; `assets/vendor/` is deleted):
  - JSZip: `import JSZip from 'jszip'` where `window.JSZip` was read; pure files keep taking `JSZip` as a parameter.
  - pdf.js: keep the lazy load, `const pdfjsLib = await import('pdfjs-dist')`, worker from `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'` → `GlobalWorkerOptions.workerSrc = workerUrl`. Remove the `file://` path (`pdf.embed.js`, `ColormerisPdfjsSource`, `pdfjsWorker`): the app is served by Vite now. Keep `FROM_DISK` exported only if other code reads it.
  - OpenRouter SDK: `loadOpenRouterSdk` keeps returning `globalThis.OpenRouterSDK` when a test or mock set it, else `await import('@openrouter/sdk')` (lazy chunk) and returns that module (it exports `OpenRouter`).
  - Example files moved to `public/examples/` and are served at `examples/…` (relative to the page): `assets/examples/x` → `examples/x`.
- **JSON Schemas** (schema.js `ACTIONS`, llm.js `RUNNER_TOOLS`, decide.js `DECISION_TOOLS`): `const ACTIONS: Record<string, ActionSpec> = {…}`. Schema pieces declared apart (`const point = { type: 'object', … }`) widen `'object'` to `string`: annotate them `const point: JsonSchema = …`.
- **Constants with literal unions** (`SCALES`, `KINDS`, `HOTKEY_ACTIONS`): annotate (`const SCALES: ColorbarScale[] = […]`) so `includes(x)` still takes a string: `(SCALES as string[]).includes(cb.scale)`.

## React

The UI is React 19 (`.tsx`); [react.md](react.md) has the design. The typing rules:

- Props are a named `type XProps = {…}` next to the component; callbacks are typed (`onChoose(name: string): void`), never `Function` or `any`.
- Components read workspace state during render through `useWorkspace(...)` and never keep a copy of a project object; `memo` and `useMemo` key on primitives (`panel.id`, a tick id), never on project objects, which are mutated in place.
- Refs to imperative hosts are typed for the element they hold (`useRef<HTMLCanvasElement>(null)`).
- `import type` for React types (`ReactNode`, `ComponentType`, `Dispatch`).

## Tests

- Tests sit next to the module (`grid.ts` → `grid.test.ts`, `panels-card.tsx` → `panels-card.test.tsx`): `import { describe, test } from 'vitest'` and `import assert from 'node:assert/strict'`; helpers from `src/testing/helpers.ts`.
- Fake timers: `vi.useFakeTimers({ toFake: ['setTimeout'] })`, `vi.advanceTimersByTime(ms)`, `vi.useRealTimers()`; stub globals with `vi.stubGlobal` before a dynamic `await import(...)` (see openrouter-client.test.ts).
- Component tests start with `// @vitest-environment jsdom`, use `@testing-library/react` and call `afterEach(cleanup)` (Vitest has no globals).
- `scripts/agent-docs.test.ts` fails when docs/agent.md is stale (`npm run docs`).
- Test values may need casts (`as Panel`); never weaken what a test checks.

## Watch for

- Properties added after creation: `grid.autoSize` (agent/api, grid-card, interact), tick `id` (not saved; source.ts assigns ids after reading a zip), `project.source.sha256` and `pageCount`/`renderScale` set after open, `ws.settings` / `ws.reviewStatus` replaced later, `app.mode.done` / `mode.lim`, handle caches (`handle.dir`, `ts`, `len`, `from`). All are in the types; do not add them at creation.
- Number or null: grid corners, colorbar ends, `scale`, `review`, `source`, `colormap`; `alt` in `fitCellCounts`; `x`/`y`/`len` of profile samples; `pxArea`. Tick values are NaN when untyped in memory but `null` in JSON. `detectGridSize` confidences can be `Infinity`.
- `makeValueFn` returns `null` for unusable ticks; `labelBins`/`colorbarBins` return `null` for a smooth bar; `refineColorbar`, `snapTick`, `cellAt` return `null` when nothing is found.
- `color(id)` returns `string | string[]` (palettes); the `COLORS` getters and single colors cast `as string`, palettes `as string[]`.
- Two image-part spellings: the SDK takes `imageUrl` (runner.ts), the Decisions API `image_url` (decision-tools.ts). Keep both.
- `PixelImage` vs `ImageData`: pure code takes `PixelImage`; DOM code holds `ImageData` (assignable to it).

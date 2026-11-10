# TypeScript conventions

Colormeris is strict TypeScript in ES modules: the viewer is bundled by Vite, and the `colormeris` package (`packages/core`) is built by `tsc` (see CLAUDE.md for the layout). The code was converted 1:1 from classic scripts in October 2026 (commits `a39363c`..`c278af4`; `git log --follow` reaches the old JS). These are the rules that conversion set, and they apply to new code. Check every change with `npm run check` (Biome lint, `tsc`, Vitest, the package build).

## Ground rules

- `strict: true`. Pure modules (no DOM: everything in `packages/core/src`, and the viewer's `route`, `recolor`, `library-cache` and the tabs' `*-model.ts`) are fully typed: no `any`. Prefer `unknown` plus a check, `Record<string, unknown>` for open objects.
- No `any` anywhere: Biome's `noExplicitAny` is an error. A seam that really needs it carries a `biome-ignore` with the reason; casts that the types can't express yet are marked `// TODO(types)`.
- `import type { … }` for types (`verbatimModuleSyntax`), always with the `.ts` extension inside a project: `import { rgbToLab } from './color.ts'`. The package's build rewrites the extensions (`rewriteRelativeImportExtensions`).
- The viewer imports the package by name: `import { mapColors } from 'colormeris'`. `vite.config.ts` and `tsconfig.json` alias it to `packages/core/src/index.ts`, so no build is needed in dev. Never import the package's files by relative path from `src/`.
- The package has no DOM and no dependencies: no `document`, `window`, `ImageData` or React in `packages/core/src`, and nothing from `src/`. It is built against `lib: ES2023` only (`packages/core/tsconfig.json`), so a DOM type there fails `npm run build:core`.
- Every file starts with a comment saying what it does; comments explain why. Keep exported names stable: `packages/core/src/exports.test.ts` lists the package's public names, and removing or renaming one is a breaking change.
- Static files are in `public/` and are fetched relative to the page.
- Formatting is Biome's; formatting-only changes go in their own commit.

## Types to use

From the package (`packages/core/src/types.ts`, re-exported by `src/types/index.ts`): `Point`, `Rgb`, `Lab`, `PixelImage` (ImageData-like; pure code takes this, not `ImageData`), `DistanceName`, `ColorbarSample`, `ColormapSource`, `ColormapGroup`, `ColormapEntry`, `PackedColormapEntry`, `ColormapData`. From the viewer (`src/types/colormaps.ts`): `ViewKey`, `ViewData`.

Types of one module only (`MatchMap`, `MapFeatures`, `ColormapMetrics`, `CvdOptions`, `RefinedColorbar`) are declared in that module and exported if another module needs them. Let return types of pure functions be inferred unless a type above fits.

## Patterns

- **Nullable values the code has already checked**: use `!` only where the code relies on the same fact, e.g. `mapByName(name)!` for a name taken from the library.
- **Constants with literal unions**: annotate them so `includes(x)` still takes a string: `(NAMES as string[]).includes(name)`.
- **JSON**: the package imports its data with `import raw from './generated/colormap-data.json' with { type: 'json' }` and casts it once to `ColormapData`.

## React

The UI is React 19 (`.tsx`); [react.md](react.md) has the design. The typing rules:

- Props are a named `type XProps = {…}` next to the component; callbacks are typed (`onChoose(name: string): void`), never `Function` or `any`.
- `memo` and `useMemo` key on primitives (a map's `name`, an index), so rows re-render only when what they show changes.
- Refs to imperative hosts are typed for the element they hold (`useRef<HTMLCanvasElement>(null)`).
- `import type` for React types (`ReactNode`, `ComponentType`, `Dispatch`).

## Tests

- Tests sit next to the module (`color.ts` → `color.test.ts`, `row.tsx` → `row.test.tsx`): `import { describe, test } from 'vitest'` and `import assert from 'node:assert/strict'`; viewer helpers in `src/testing/helpers.ts`, package helpers in `packages/core/src/testing.ts`.
- Golden tests guard refactors: `packages/core/src/golden.test.ts` (with `testing-golden.ts`) checks every public function against hashes computed before the package was split out, and `src/colormaps/golden.test.ts` does the same for the whole library's metrics and views. The numbers must stay the same.
- Fake timers: `vi.useFakeTimers({ toFake: ['setTimeout'] })`, `vi.advanceTimersByTime(ms)`, `vi.useRealTimers()`; stub globals with `vi.stubGlobal`.
- Component tests start with `// @vitest-environment jsdom`, use `@testing-library/react` and call `afterEach(cleanup)` (Vitest has no globals).
- Test values may need casts; never weaken what a test checks.

## Watch for

- `mapColors` returns shared arrays (the caches key on them): never mutate them; copy with `slice()` first (e.g. to reverse).
- `refineColorbar` returns `null` when no strip is found; `colormapSamples` returns `null` for an unknown name; `suggestColormap` returns `null` without data or with fewer than 2 colors; `minSeparation` returns `null` with fewer than 2 points; `readability` returns `null` for qualitative maps.
- `PixelImage` vs `ImageData`: pure code takes `PixelImage`; DOM code holds `ImageData` (assignable to it).

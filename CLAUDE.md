# Colormeris: notes for Claude sessions

Colormeris (Landry lab, UC Berkeley) has two parts:

1. The **colormap viewer**, a static web app and the site's home page (`index.html`): 1063 colormaps with five tabs, Browse, Compare, Identify, Recolor and CVD. `colormaps.html` is only a redirect to `./` that keeps `?map=` and `#tab`.
2. The **npm package `colormeris`** in `packages/core/` (version 0.1.0, not yet published): the colormap library, color science (CIELAB, ΔE2000, CVD simulation), colormap matching and ratings, and colorbar sampling, as pure TypeScript with no DOM and no dependencies. The viewer is built on it.

The figure extraction tools (heatmap, ROI and map tools, the LLM agent) were removed from this repository on 2026-11-10; the history before that has them.

[README.md](README.md) is a short overview, [packages/core/README.md](packages/core/README.md) the package's README (shown on npm) and [docs/usage.md](docs/usage.md) the viewer's manual (read only for user-facing behavior).

## Commands

```bash
npm run dev          # Vite dev server → http://localhost:8000 (hot reload, also for packages/core/src)
npm run check        # biome lint + tsc + vitest + build:core (must pass before commits)
npm test             # vitest only (unit tests next to their modules: src/**/*.test.ts(x), packages/core/src/*.test.ts)
npm run build        # the site in dist/; npm run preview serves it
npm run build:core   # the package: tsc -p packages/core/tsconfig.json → packages/core/dist/
npm run pack:core    # build:core, then npm pack → packages/core/colormeris-<version>.tgz (git-ignored)
npm run format       # biome format
npm run perf         # after npm run build: viewer timings in headless Chrome on port 8006 (PERF_OUT=<dir> for another build, e.g. main)
uv run --with matplotlib --with cmasher --with cmcrameri --with cmocean --with colorcet --with seaborn --with colormaps python scripts/export-mpl-colormaps.py   # regenerate packages/core/src/generated/colormap-data.json
```

`scripts/fetch-r-palettes.py` refreshes the R palettes in `scripts/data/r-palettes.json`, which the export script reads.

**Releasing the package**: bump `version` in `packages/core/package.json`, commit, then push a tag `core-vX.Y.Z` with the same version. `.github/workflows/release.yml` checks that the tag matches, runs lint, typecheck, tests and `build:core`, and publishes to npm with provenance. It needs the repository secret `NPM_TOKEN`. Tag and push only when the user asks.

`.claude/launch.json` has the preview configs `colormeris` (Vite, port 8000), `colormeris-alt` (Vite, port 8002, when 8000 is taken) and `colormeris-build` (build + `vite preview` on 8004). Start them with preview_start, not Bash. CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, the site build and `pack:core` on every push; `pages.yml` deploys `dist/` to GitHub Pages after CI passes on `main`.

No secrets are needed. If a `.env` file exists, never print it.

## Architecture

TypeScript (strict) ES modules, bundled by Vite. `index.html` loads one entry, `src/pages/colormaps.ts`; files import what they use (no global namespace, no load order). The viewer imports the package by name (`import { mapColors } from 'colormeris'`): `vite.config.ts` and `tsconfig.json` alias `colormeris` to `packages/core/src/index.ts`, so there is no build step in dev; npm gets the built `packages/core/dist/`. Typing conventions are in [docs/typescript.md](docs/typescript.md); no `any` (`noExplicitAny` is an error). The whole page is React 19; strips, plots, the tooltip and figure canvases stay imperative behind refs. **Read [docs/react.md](docs/react.md) before touching UI code** (state, URL sync, lazy Browse rows, the scroll anchor, the performance budget).

Files are grouped by feature. **Pure** files (no DOM) have unit tests next to them (`route.ts` + `route.test.ts`). Every file starts with a comment saying what it does.

| Folder | Files |
| --- | --- |
| `packages/core/` | The `colormeris` package. `package.json` (ESM only, `exports` → `dist/`, `files` leaves out tests and test helpers), `tsconfig.json` (builds `src/` to `dist/` with `.d.ts`; `lib: ES2023`, so DOM types fail the build). `src/`: `color.ts` (sRGB ↔ CIELAB, ΔE76 / ΔE2000, `colorDistance`, LCh, `rgbToHex`, `parseHexColors`), `cvd.ts` (CVD simulation: Machado / Brettel / Viénot with severity, `simulateCvdColor`, `simulateCvdPixels`, grayscale, `lightness`, `lightnessStats`), `stats.ts` (`median`, `medianInPlace`, `upperMedian`, `pct`), `colormap-library.ts` (`cmapData`, `mapByName`, `mapColors` (parsed once, shared arrays), `libraryMaps`; unpacks `generated/colormap-data.json`, written by `scripts/export-mpl-colormaps.py`: do not edit the JSON), `colormap-match.ts` (`identifyColorbar`, `identifyColors`, `suggestColormap`, `colormapSamples`, `cmapColorAt`, `matchLevel`), `metrics.ts` (steps, LCh, separations, readability, `colormapMetrics`, `ratingNotes`, `ratingMethod`), `references.ts` (`CMAP_REFS`, `citeFor`, `buildRefNumbers`), `colorbar.ts` (`sampleColorbar`, `labToT`, `colorAtT`, `projectT`, `pointAtT`), `colorbar-refine.ts` (`refineColorbar`), `pixels.ts` (`readPixel`), `types.ts`, `index.ts` (barrel). Tests: next to each module; `exports.test.ts` lists the public names (removing one is a breaking change); `golden.test.ts` + `testing-golden.ts` check every public function against hashes computed before the split; `testing.ts` has image helpers. |
| `src/pages/` | `colormaps.ts`: the entry; renders `ColormapsApp` into `#cmap-root`, startup error banner. |
| `src/colormaps/` | pure: `route.ts` (`parseViewerRoute` / `formatViewerUrl`: `#tab`, `?map=`, `?compare=`), `recolor.ts`, `library-cache.ts` (per-map caches: `base`, `viewData`, `metrics`, `notesOf`, `sepOf`), `tooltip-core.ts`. DOM helpers: `common.ts` (constants, `el` / `svgEl`, views), `figure-input.ts` (drop zone and line drag shared by Identify, Recolor and CVD), `plots.ts` (SVG builders), `strip-paint.ts`, `tooltip-element.ts`, `scroll-anchor.ts` (keeps the reader's place on resize). `map-picker.tsx` (combobox, `mountMapPicker`). `golden.test.ts` hashes the whole library's metrics and views. |
| `src/colormaps/app/` | React: `colormaps-app.tsx` (shell: reducer `viewer-state.ts`, contexts `viewer-context.ts`, `use-url-sync.ts`, `use-scroll-anchor.ts`, `tab-nav.tsx`, `sticky-top.tsx`, footer, `ref-numbers.ts`, `focus-registry.ts`); one folder per tab with its pure `*-model.ts`: `browse/` (`browse-model.ts`, rows built when near the view by `use-row-visible.ts`), `compare/` (tray, plots, sine pattern, drag reorder), `identify/`, `recolor/` (`recolor-engine.ts`), `cvd/`; `detail/` (drawer or inline, folds in `detail-folds.ts`); `shared/` (strips, probe strip, SVG figures, figure input, ratings, tooltip, anchored popovers). |
| `src/types/` | `index.ts` re-exports the package's types and `colormaps.ts` (`ViewKey`, `ViewData`). |
| `src/ui/` | `flush.ts`: `flushSafely`, `flushSync` that refuses to nest. |
| `src/styles/` | `base.css` (tokens, light and dark themes, top bar, buttons, fields, shared components), `colormaps.css` (the viewer). |
| `src/testing/` | `helpers.ts` (synthetic images), `intersection-observer.ts` (a stand-in for jsdom). |
| `scripts/` | `export-mpl-colormaps.py` (the colormap data; sources and filtering rules in its docstring), `fetch-r-palettes.py` + `data/`, `perf/` (`run.mjs`, `bench.js`). |

Libraries from npm (pinned): React 19 and react-dom only. The package has no dependencies; keep it that way. `public/examples/example-jet.png` (a synthetic jet figure) is loaded by the *Example* buttons of Identify, Recolor and CVD at `examples/…`. `test-images/` is git-ignored.

## Conventions

- Match the surrounding code: small functions, comments that explain *why*, and the existing naming. README and docs use short, plain sentences.
- Commit only when the user says "commit". Messages have a short title and a body explaining why, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The branch is `main`; nothing has been pushed by Claude. Work on a branch named for the change (e.g. `split`, `react`) when the user asks for one.
- Vite hashes built file names, so there is no manual cache busting. Lint and format with Biome (`biome.jsonc` says why each relaxed rule is off); formatting-only changes go in their own commit.
- Add a unit test for pure logic (`x.test.ts` next to `x.ts`: Vitest with `node:assert/strict`); browser behaviour is checked in the preview.
- **The package's results must not change by accident**: the golden tests fail on any changed number. A deliberate change updates the hashes and says so in the commit. Public names are listed in `exports.test.ts`; a removed or renamed export needs a major version.
- The package's README is what npm shows: update `packages/core/README.md` when an export changes.

### UI standard (the viewer)

- **Tokens** on `:root` in `base.css`: colors (`--bg`, `--surface`, `--text`, `--muted`, `--accent`, …, redefined for dark mode), `--control-h` (32 px), `--control-h-sm` (28 px), `--space-1..3`, `--fs-xs/sm/md`, `--radius`. Use tokens, not literal colors, so both themes work.
- **Buttons**: the viewer uses `.btn.small`: default (bordered) for secondary actions such as Choose, Example and Clear; `primary` (blue) for the one main action of a place (*Download PNG*, the tray's *Compare*); `subtle` (borderless, with a hover background) for small utilities such as ×.
- **Toggles and modes**: `.active` and `aria-pressed` are set together.
- **Icon-only buttons** carry `title` and `aria-label`.
- **Popups** (the colormap picker list, popovers) must fit in the view and never scroll the page sideways.
- **No instructional text** on the page: no gray how-to sentences. Put guidance in `title` tooltips, the **?** popovers or the footer's methods. Empty hints collapse.
- Select options use plain text (Log10, not Log₁₀). Labels are short, with units in the label and explanations in `title`.
- Respect `prefers-reduced-motion` (Recolor dims instead of flashing).
- Shared components go in `base.css`; rules for the viewer go in `colormaps.css`.

## Browser testing tips (Claude's built-in browser)

- The Vite dev server reloads the page on save, also for edits in `packages/core/src`. Check production behaviour on the `colormeris-build` preview (it rebuilds on start).
- Resizing with `resize_window` fires no `resize` event and no media-query `change`: dispatch `window.dispatchEvent(new Event('resize'))` yourself. Scroll events are not delivered while the pane is hidden either (they run in rendering steps), so after setting `scrollTop` dispatch `new Event('scroll')` on the scroller; a screenshot advances frames but also fires `resize`. The viewer keeps the reader's place on resize (`createScrollAnchor` in `colormaps/scroll-anchor.ts`, wired by `app/use-scroll-anchor.ts`) from the anchor saved on scroll.
- Browse rows are built by an IntersectionObserver, which needs frames: take a screenshot after scrolling or expanding sections. When the Browser pane is hidden, `requestAnimationFrame` is paused too.
- `javascript_tool` calls time out after 45 s.
- Chrome color-manages PNGs (Display P3 screenshots), so Python/PIL decodes of a test image differ from what the page sees. For offline checks of Identify or Recolor, dump `getImageData` after `createImageBitmap` instead.
- Identify, Recolor and CVD take a figure by Choose, drop or paste (`figure-input.ts`), or the jet example button. A synthetic figure with known truth (e.g. a viridis bar drawn on a canvas) should be identified as viridis at an `exact` level.

## Status

- 2026-11-10 (branch `split`): the extraction tools were removed and the shared color code became the `colormeris` package. The viewer moved to the home page. The golden tests show the package gives the same results as the code before the split.
- The package is not on npm yet: it needs a license (none chosen; `packages/core/README.md` says `TODO: license`), the `NPM_TOKEN` secret and a first `core-v0.1.0` tag.
- React UI (2026-10-29) and TypeScript migration (2026-10-28): see docs/react.md for the design and the A/B against the pre-React build.

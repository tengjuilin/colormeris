# Colormeris

Colormeris is a colormap viewer and a small npm package for colormaps and color science (Landry lab, UC Berkeley). Everything runs in the browser; images you load never leave it.

## Colormap viewer

The home page (`index.html`) shows 1063 colormaps from Matplotlib, CMasher, Crameri, cmocean, colorcet, seaborn, CarbonPlan, NCL, SciVisColor, CARTOColors, MATLAB and R palettes. It has five tabs:

- **Browse**: every map as strips, as seen, with protanopia, deuteranopia and tritanopia, and in grayscale. Each map is rated uniform, CVD-safe, grayscale-safe and readable. Click a map for its lightness, ΔE2000 steps, chroma and hue.
- **Compare**: up to 10 maps side by side, with the same plots on shared axes and a table of their numbers.
- **Identify**: drag along the colorbar of a figure and get the closest maps and their direction.
- **Recolor**: show a figure in another colormap, e.g. a jet figure in viridis.
- **CVD**: see a figure as it may look with a color vision deficiency.

The tab, the open map and the comparison are in the URL (`?map=viridis`, `?compare=viridis,cividis#compare`), so links can be shared. Old `colormaps.html` links redirect to the home page. The manual is [docs/usage.md](docs/usage.md).

## npm package

`colormeris` (in [packages/core](packages/core)) has the viewer's engine as pure TypeScript functions with no dependencies: the colormap library, CIELAB and ΔE2000, CVD simulation, colormap matching, ratings and colorbar sampling. It is not published yet.

```bash
npm install colormeris
```

```ts
import { identifyColorbar, libraryMaps, mapByName, mapColors, simulateCvdColor } from 'colormeris';

const rgbs = mapColors(mapByName('viridis')!); // 256 × [r, g, b]
simulateCvdColor([255, 0, 0], 'deuteranopia'); // [163, 144, 0]
identifyColorbar(barColors, libraryMaps())[0]; // { name: 'magma', reversed: true, score, … }
```

See [packages/core/README.md](packages/core/README.md) for every export.

## Development

Node 22.18+. TypeScript (strict), React 19 and Vite.

```bash
npm install
npm run dev          # http://localhost:8000
npm run check        # lint, typecheck, tests and the package build, before every commit
npm run build        # the site in dist/ (npm run preview serves it)
npm run build:core   # the package in packages/core/dist/
npm run pack:core    # the package as a .tgz in packages/core/
```

The site imports the package from its source, so edits in `packages/core/src/` reload at once. CI runs lint, typecheck, tests, the build and the package pack; `main` deploys to GitHub Pages, and a tag `core-vX.Y.Z` publishes the package to npm.

Docs: [docs/usage.md](docs/usage.md) (the viewer's manual), [docs/react.md](docs/react.md), [docs/typescript.md](docs/typescript.md), and [CLAUDE.md](CLAUDE.md) (architecture, conventions, status).

## License

MIT. See [LICENSE](LICENSE).

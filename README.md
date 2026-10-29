# Colormeris

Colormeris is a set of static web pages that turn colors in scientific figures back into numbers. Load a PDF, PNG or JPG, mark the colorbar and read values out as CSV. Everything runs in the browser; nothing is uploaded except when you run the heatmap agent (page images and values go to OpenRouter and your chosen models).

- `index.html`: landing page.
- `extract.html`: three tools sharing the file, viewer, colorbar calibration and project zip: **Heatmap** (one value per grid cell), **ROI** (signal in regions, e.g. IVIS images), **Map** (near-continuous fields, value matrix and line profiles). Switch with `#heatmap` / `#roi` / `#map`.
- `colormaps.html`: browse, compare, identify, recolor and CVD-simulate 1063 colormaps.

## Heatmap agent

The *Agent* card calibrates every heatmap on the chosen pages. Enter an [OpenRouter](https://openrouter.ai/keys) key in *Settings → Agent*, or keep it out of the browser: put `OPENROUTER_API_KEY=…` in `.env`, run `npm run proxy` and set *API base URL* to `http://localhost:8787/api/v1`. Modes: **Agent only** (the LLM does everything) and **Agent decision** (the LLM describes heatmaps, a decision model locates them, the app snaps and counts). Checks below *Min. confidence* go to *Needs review*. Typed actions are exposed as `window.colormeris`: see [docs/agent.md](docs/agent.md).

## Development

Node 22.18+. TypeScript (strict) with Vite.

```bash
npm install
npm run dev       # http://localhost:8000
npm run check     # biome + tsc + vitest, before every commit
npm run build     # dist/ (npm run preview serves it)
npm run docs      # regenerate docs/agent.md after changing the agent
```

Docs: [docs/usage.md](docs/usage.md) (user manual), [docs/agent.md](docs/agent.md) (agent API, generated), [docs/research.md](docs/research.md), [docs/react.md](docs/react.md), [docs/typescript.md](docs/typescript.md), and [CLAUDE.md](CLAUDE.md) (architecture, conventions, status). CI runs lint, typecheck, tests and build; `main` deploys to GitHub Pages.

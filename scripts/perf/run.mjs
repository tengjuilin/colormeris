// Runs scripts/perf/bench.js in headless Chrome against the production build
// and prints medians over several fresh page loads (npm run perf, after
// npm run build). Uses the installed Chrome (CHROME_PATH to override); no
// browser download. Numbers are only comparable on the same machine.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '../..');
const PORT = 8010;
const LOADS = Number(process.env.PERF_LOADS ?? 5);
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
await new Promise((ok, fail) => {
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && ok());
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// Medians of every numeric leaf across the runs, keeping the shape.
function combine(runs) {
  const first = runs[0];
  if (typeof first === 'number') return Math.round(median(runs) * 100) / 100;
  if (first && typeof first === 'object')
    return Object.fromEntries(Object.keys(first).map((k) => [k, combine(runs.map((r) => r[k]))]));
  return first;
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const results = {};
  for (const [name, path, fn] of [
    ['extract', 'extract.html#heatmap', 'extract'],
    ['colormaps', 'colormaps.html#browse', 'colormaps'],
  ]) {
    const runs = [];
    for (let i = 0; i < LOADS; i++) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.goto(`http://127.0.0.1:${PORT}/${path}`, { waitUntil: 'load' });
      await page.addScriptTag({ path: resolve(import.meta.dirname, 'bench.js') });
      runs.push(await page.evaluate(`perfBench.${fn}()`));
      if (errors.length) console.error(`${name} errors:`, errors);
      await page.close();
    }
    results[name] = combine(runs);
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  server.kill();
}

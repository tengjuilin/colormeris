// Browser-side timing harness for the React migration's performance budget
// (docs/react.md). Paste into the page (built-in browser javascript_tool) and
// run `await perfBench.extract()` on extract.html#heatmap or
// `await perfBench.colormaps()` on colormaps.html. Medians of several runs, in ms.
// It drives the UI only through ids and classes both the old and the React
// UI keep (#grid-rows, .cmap-th, .cmap-search, .cmap-row), so the same
// numbers are comparable before and after.

globalThis.perfBench = (() => {
  // Forced layout, then the next task: React's microtask renders and layout are
  // included, and it works while the Browser pane is hidden (no animation frames).
  const frame = () =>
    new Promise((r) => {
      void document.body.offsetHeight;
      setTimeout(r, 0);
    });
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const round = (x) => Math.round(x * 100) / 100;

  // Sync time of fn() plus the time until layout is done.
  async function timed(fn) {
    const t0 = performance.now();
    await fn();
    const sync = performance.now() - t0;
    await frame();
    return { sync, total: performance.now() - t0 };
  }

  async function runs(n, fn) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(await timed(fn));
    return { sync: round(median(out.map((o) => o.sync))), total: round(median(out.map((o) => o.total))) };
  }

  let longTasks = 0;
  try {
    new PerformanceObserver((l) => (longTasks += l.getEntries().length)).observe({ type: 'longtask' });
  } catch {}

  function load() {
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return { fcp: round(fcp?.startTime ?? Number.NaN), loadEnd: round(nav?.loadEventEnd ?? Number.NaN) };
  }

  // Sets an input's value the way typing does, so React's onChange sees it too.
  function typeInto(input, value) {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // A 20 × 20 viridis-like grid with a colorbar, as a data URL.
  function figure() {
    const c = document.createElement('canvas');
    c.width = 1000;
    c.height = 800;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    const col = (t) => `hsl(${260 - 200 * t}, 70%, ${25 + 50 * t}%)`;
    for (let r = 0; r < 20; r++)
      for (let k = 0; k < 20; k++) {
        g.fillStyle = col(((r * 7 + k * 13) % 20) / 19);
        g.fillRect(100 + k * 30, 100 + r * 30, 30, 30);
      }
    for (let y = 0; y < 600; y++) {
      g.fillStyle = col(1 - y / 599);
      g.fillRect(760, 100 + y, 25, 1);
    }
    return c.toDataURL();
  }

  async function extract() {
    window.confirm = () => true;
    const api = window.colormeris;
    const out = { load: load() };
    await api.run('open_url', { url: figure() });
    await api.batch([
      { name: 'set_grid', args: { topLeft: { x: 100, y: 100 }, bottomRight: { x: 700, y: 700 } } },
      { name: 'set_grid_size', args: { rows: 20, cols: 20 } },
      { name: 'set_colorbar', args: { start: { x: 772, y: 699 }, end: { x: 772, y: 100 }, snap: false } },
      { name: 'add_tick', args: { t: 0, value: 0, snap: false } },
      { name: 'add_tick', args: { t: 1, value: 100, snap: false } },
    ]);
    const tickId = (await api.run('get_state')).result.panels[0].colorbar.ticks[0]?.id;
    // 20 project-changing actions through the agent API (full changed() each).
    out.agentBatch20 = await runs(5, () =>
      api.batch(
        Array.from({ length: 20 }, (_, i) =>
          tickId
            ? { name: 'set_tick_value', args: { tickId, value: 100 + (i % 2) } }
            : { name: 'set_grid_size', args: { rows: 20 + (i % 2), cols: 20 } },
        ),
      ),
    );
    // 100 keystrokes in a number field: the light-change path a handle drag also takes.
    const rows = document.getElementById('grid-rows');
    out.typing100 = await runs(5, async () => {
      rows.focus();
      for (let i = 0; i < 100; i++) typeInto(rows, 20 + (i % 2));
      rows.dispatchEvent(new Event('change', { bubbles: true }));
      rows.blur();
    });
    out.undo = await runs(5, () => api.run('undo'));
    out.longTasks = longTasks;
    return out;
  }

  async function colormaps() {
    const out = { load: load() };
    out.rowsAtLoad = document.querySelectorAll('.cmap-row').length;
    const rev = [...document.querySelectorAll('label')]
      .find((l) => l.textContent.trim() === 'Reversed')
      ?.querySelector('input');
    if (rev) out.reversedToggle = await runs(6, () => rev.click());
    const sortBtn = document.querySelector('.cmap-th[data-sort]');
    if (sortBtn) out.sortClick = await runs(6, () => sortBtn.click());
    const search = document.querySelector('.cmap-search');
    if (search)
      out.search = await runs(4, async () => {
        typeInto(search, 'vir');
        await frame();
        typeInto(search, '');
      });
    for (const tab of ['compare', 'identify', 'recolor', 'cvd', 'browse']) {
      out[`tab_${tab}`] = await runs(3, async () => {
        location.hash = `#${tab}`;
        await frame();
      });
    }
    out.longTasks = longTasks;
    return out;
  }

  return { extract, colormaps };
})();

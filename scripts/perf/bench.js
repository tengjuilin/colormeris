// Browser-side timing harness for the React migration's performance budget
// (docs/react.md). Paste into the page (built-in browser javascript_tool) and
// run `await perfBench.colormaps()` on the viewer. Medians of several runs, in ms.
// It drives the UI only through ids and classes both the old and the React
// UI keep (.cmap-th, .cmap-search, .cmap-row), so the same
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
    // Let the idle metric precompute and lazy row builds settle first, or they land in the tab timings.
    await new Promise((r) => setTimeout(r, 1000));
    for (const tab of ['compare', 'identify', 'recolor', 'cvd', 'browse']) {
      out[`tab_${tab}`] = await runs(3, async () => {
        location.hash = `#${tab}`;
        await frame();
      });
    }
    out.longTasks = longTasks;
    return out;
  }

  return { colormaps };
})();

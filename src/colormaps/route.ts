
// Pure: the colormap viewer's URL (colormaps.html). Which tab is open
// (#browse, #compare, …), which map shows its details (?map=) and which
// maps are compared (?compare=). Tested in tests/colormaps/route.test.js.

// The maps chosen for side-by-side comparison, from the page URL
// (?compare=viridis,jet). Unknown names and repeats are dropped, matching
// ignores case, and at most `max` are kept, so a hand-edited or old link
// still opens a valid comparison.
export const COMPARE_MAX = 10;

export function parseCompare(param: string | null | undefined, names: string[], max = COMPARE_MAX) {
  const byLower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const out: string[] = [];
  for (const part of String(param ?? '').split(',')) {
    const name = byLower.get(part.trim().toLowerCase());
    if (name && !out.includes(name)) out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

// What the viewer opens on, from its URL: the tab (#browse, #compare,
// #identify, #recolor, #cvd), the map whose details are open (?map=) and the compared maps
// (?compare=). Other hashes (#ref-…) leave the tab alone (tab: null). Old
// shared links have only ?compare=, so they open on the comparison.
export const VIEWER_TABS = ['browse', 'compare', 'identify', 'recolor', 'cvd'];

export function parseViewerRoute(search: string | null | undefined, hash: string | null | undefined, names: string[]) {
  const params = new URLSearchParams(search || '');
  const compare = parseCompare(params.get('compare'), names);
  const want = String(params.get('map') ?? '').trim().toLowerCase();
  const map = want ? names.find((n) => n.toLowerCase() === want) ?? null : null;
  const h = String(hash || '').replace(/^#/, '').toLowerCase();
  let tab = VIEWER_TABS.includes(h) ? h : null;
  if (!h) tab = compare.length && !map ? 'compare' : 'browse';
  return { tab, map, compare };
}

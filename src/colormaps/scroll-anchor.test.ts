// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { createScrollAnchor } from './scroll-anchor.ts';

// jsdom has no layout: give elements rects from a table the test edits.
const tops = new Map<Element, { top: number; height: number }>();
const rect = (el: Element) => {
  const r = tops.get(el) ?? { top: 0, height: 0 };
  return {
    top: r.top,
    bottom: r.top + r.height,
    height: r.height,
    left: 0,
    right: 0,
    width: 100,
    x: 0,
    y: r.top,
  } as DOMRect;
};

function setup() {
  document.body.innerHTML = `<div id="root"><div id="top"></div>
    <div class="cmap-item"><div class="cmap-row" id="a"></div></div>
    <div class="cmap-item"><div class="cmap-row" id="b"></div></div></div>`;
  const root = document.getElementById('root') as HTMLElement;
  const top = document.getElementById('top') as HTMLElement;
  for (const el of [root, top, ...root.querySelectorAll<HTMLElement>('.cmap-row')]) {
    el.getBoundingClientRect = () => rect(el);
  }
  // offsetParent is null in jsdom; the anchor search skips such elements.
  for (const el of root.querySelectorAll('.cmap-row')) Object.defineProperty(el, 'offsetParent', { get: () => root });
  tops.set(root, { top: 0, height: 500 });
  tops.set(top, { top: 0, height: 40 });
  tops.set(document.getElementById('a') as Element, { top: -30, height: 100 });
  tops.set(document.getElementById('b') as Element, { top: 120, height: 100 });
  // Above 820 px the pane scrolls: scrolling it moves every row.
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    (el: Element) =>
      ({
        overflowY: el === root ? 'auto' : 'visible',
        position: el === top ? 'sticky' : 'static',
        paddingTop: '0',
      }) as CSSStyleDeclaration,
  );
  let scrollTop = 0;
  Object.defineProperty(root, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => {
      const d = v - scrollTop;
      scrollTop = v;
      for (const r of root.querySelectorAll('.cmap-row')) {
        const t = tops.get(r) as { top: number; height: number };
        t.top -= d;
      }
    },
  });
  return { root, top, a: document.getElementById('a') as HTMLElement, b: document.getElementById('b') as HTMLElement };
}

afterEach(() => {
  vi.restoreAllMocks();
  tops.clear();
});

const ctx = { drawer: null, openRow: null, tab: 'browse' };

test('restore aligns the saved anchor back below the sticky bar', () => {
  const { root, top, a } = setup();
  const sa = createScrollAnchor({ root, top });
  sa.freeze();
  // The layout change pushes everything down 50 px.
  (tops.get(a) as { top: number }).top = 20;
  (tops.get(document.getElementById('b') as Element) as { top: number }).top = 220;
  sa.restore(null, ctx);
  // Anchor a sat at -30 relative to a visible top of 40 (the bar): offset -70.
  const r = a.getBoundingClientRect();
  assert.ok(Math.abs(r.top - (40 - 70)) < 1.01, `row a at ${r.top}`);
  sa.dispose();
});

test('freeze blocks later until restore', () => {
  const { root, top, a } = setup();
  const sa = createScrollAnchor({ root, top });
  sa.freeze();
  (tops.get(a) as { top: number }).top = 500; // moved by the layout change
  sa.later(); // would save the moved position as the anchor
  sa.restore(null, ctx);
  assert.ok(Math.abs(a.getBoundingClientRect().top - -30) < 1.01);
  sa.dispose();
});

test('later saves again after restore, and a saved anchor is what restore uses', () => {
  const { root, top, a } = setup();
  const sa = createScrollAnchor({ root, top });
  root.scrollTop = 10; // a is now at -40
  sa.save();
  (tops.get(a) as { top: number }).top = 0;
  sa.restore(null, ctx);
  assert.ok(Math.abs(a.getBoundingClientRect().top - -40) < 1.01);
  sa.dispose();
});

// The open detail is a new subtree after a move between the drawer and the
// list; the saved part is found again by its index in `.cmap-detail`.
function detailOf(parent: HTMLElement, rects: Array<{ top: number; height: number }>) {
  const detail = document.createElement('div');
  detail.className = 'cmap-detail';
  rects.forEach((r, i) => {
    const part = document.createElement('div');
    part.id = `${parent.id}-part-${i}`;
    part.getBoundingClientRect = () => rect(part);
    Object.defineProperty(part, 'offsetParent', { get: () => parent });
    tops.set(part, r);
    detail.append(part);
  });
  parent.replaceChildren(detail);
  return detail;
}

function withDrawer() {
  const s = setup();
  const item = s.a.closest('.cmap-item') as HTMLElement;
  const panel = document.createElement('div');
  panel.className = 'cmap-panel';
  panel.id = 'panel';
  item.append(panel);
  const drawer = document.createElement('aside');
  drawer.id = 'drawer';
  drawer.getBoundingClientRect = () => rect(drawer);
  tops.set(drawer, { top: 0, height: 500 });
  let scrollTop = 0;
  Object.defineProperty(drawer, 'scrollTop', { get: () => scrollTop, set: (v: number) => (scrollTop = v) });
  s.root.append(drawer);
  tops.set(s.a, { top: -300, height: 100 }); // the open row is above the visible area
  return { ...s, panel, drawer };
}

test('drawer to list: the part at the top of the drawer is found in the new inline detail', () => {
  const { root, top, a, panel, drawer } = withDrawer();
  detailOf(drawer, [
    { top: -200, height: 100 },
    { top: -20, height: 150 },
    { top: 130, height: 100 },
  ]);
  const sa = createScrollAnchor({ root, top });
  sa.freeze(drawer);
  // The layout change: the drawer's detail goes, a new one appears under the row.
  drawer.replaceChildren();
  detailOf(panel, [
    { top: 100, height: 100 },
    { top: 300, height: 150 },
    { top: 450, height: 100 },
  ]);
  sa.restore({ from: 'drawer', to: 'inline' }, { drawer, openRow: a, tab: 'browse' });
  // part 1 sat 20 px above the drawer's top; the visible top is 40 (the bar).
  assert.equal(root.scrollTop, 300 - 40 + 20);
  sa.dispose();
});

test('list to drawer: the part that was on screen is shown in the new drawer detail', () => {
  const { root, top, a, panel, drawer } = withDrawer();
  detailOf(panel, [
    { top: -100, height: 120 }, // ends above the bar's bottom (40)
    { top: 20, height: 150 }, // the anchor: 20 px above the bar's bottom
    { top: 170, height: 100 },
  ]);
  const sa = createScrollAnchor({ root, top });
  sa.freeze(null);
  panel.replaceChildren();
  detailOf(drawer, [
    { top: 0, height: 100 },
    { top: 100, height: 150 },
    { top: 250, height: 100 },
  ]);
  sa.restore({ from: 'inline', to: 'drawer' }, { drawer, openRow: a, tab: 'browse' });
  // Part 1 was 20 px above the bar's bottom; it now has to sit 20 px above the drawer's top.
  assert.equal(drawer.scrollTop, 120);
  sa.dispose();
});

test('nothing resolves in the new detail: fall back to the open row', () => {
  const { root, top, a, panel, drawer } = withDrawer();
  detailOf(drawer, [{ top: -20, height: 150 }]);
  const sa = createScrollAnchor({ root, top });
  sa.freeze(drawer);
  drawer.replaceChildren(); // no inline detail at all
  panel.replaceChildren();
  tops.set(a, { top: 200, height: 100 });
  sa.restore({ from: 'drawer', to: 'inline' }, { drawer, openRow: a, tab: 'browse' });
  assert.equal(root.scrollTop, 200 - 40);
  sa.dispose();
});

// Keep the reader's place in the colormap viewer when the window is resized.
//
// A resize reflows the list and can move the open detail between the
// drawer and the list, so the page length changes and the content under
// the reader would jump. We remember what is at the top of the visible
// area (below the sticky bar) and put it back there after each resize.
//
// createScrollAnchor is the plain-DOM core (no React): it listens for
// scroll, click and fold changes to keep a saved anchor fresh, and the
// caller brackets a layout change with freeze() ... restore() (the resize
// handler in app/use-scroll-anchor.ts).
const ANCHORS =
  '.cmap-item > .cmap-row, .cmap-panel .cmap-detail > *, .cmap-section > summary, .cmap-sub > summary, ' +
  '.cmap-compare-head, .cmap-compare-body > *, .cmap-identify > *, .cmap-recolor > *, .cmap-cvd > *, .cmap-about';

/** An element near the top of the visible area, with where it sat and how tall it was. */
export interface Anchor {
  el: HTMLElement;
  offset: number;
  height: number;
  /**
   * Set when `el` is a direct child of a `.cmap-detail`: its index there. The
   * detail is a new subtree after it moves between the drawer and the list,
   * so `el` is gone by then; the index finds the same part in the new one.
   */
  index?: number;
}

/** Which way the open detail moved on a resize. */
export interface DetailMove {
  from: 'drawer' | 'inline';
  to: 'drawer' | 'inline';
}

export interface RestoreContext {
  drawer: HTMLElement | null;
  /** The open map's `.cmap-row` in the list, if a map is open. */
  openRow: HTMLElement | null;
  tab: string;
}

export interface ScrollAnchor {
  /** Remember what is at the top now. */
  save(): void;
  /** `save`, at once or at most every 50 ms; a no-op while frozen. */
  later(): void;
  /** Keep the anchor (and the drawer's top part) from before a layout change. `drawer`: the open drawer, if any. */
  freeze(drawer?: HTMLElement | null): void;
  /** Undo the layout change's jump, then save and unfreeze. */
  restore(moved: DetailMove | null, ctx: RestoreContext): void;
  /** Put `el` back `offset` below the visible top. */
  alignTo(el: HTMLElement, offset: number, height?: number): void;
  dispose(): void;
}

export function createScrollAnchor({ root, top }: { root: HTMLElement; top: HTMLElement }): ScrollAnchor {
  // Above 820px only the page pane scrolls; below it the document does.
  const paneScrolls = () => getComputedStyle(root).overflowY === 'auto';

  function visibleTop() {
    let y = paneScrolls() ? root.getBoundingClientRect().top : 0;
    if (getComputedStyle(top).position === 'sticky') y = Math.max(y, top.getBoundingClientRect().bottom);
    return y;
  }

  function detailIndex(el: HTMLElement): number | undefined {
    const parent = el.parentElement;
    return parent?.classList.contains('cmap-detail') ? Array.prototype.indexOf.call(parent.children, el) : undefined;
  }

  // The same anchor in the (possibly new) `detail`: itself when still in it,
  // else the child at its index; null when neither exists.
  function inDetail(a: Anchor, detail: Element | null | undefined): Anchor | null {
    if (!detail) return null;
    if (a.el.isConnected && detail.contains(a.el)) return a;
    const el = a.index === undefined ? undefined : detail.children[a.index];
    return el ? { ...a, el: el as HTMLElement } : null;
  }

  function findAnchor(): Anchor | null {
    const y = visibleTop();
    for (const el of root.querySelectorAll<HTMLElement>(ANCHORS)) {
      if (!el.offsetParent) continue; // hidden, or in a folded section
      const r = el.getBoundingClientRect();
      if (r.bottom > y) return { el, offset: r.top - y, height: r.height, index: detailIndex(el) };
    }
    return null;
  }

  const drawerTopY = (drawer: HTMLElement) =>
    drawer.getBoundingClientRect().top + (parseFloat(getComputedStyle(drawer).paddingTop) || 0);

  // The part of the detail at the top of the drawer's visible area, with its
  // offset from there, so the same part can be shown after a move.
  function drawerAnchor(drawer: HTMLElement | null | undefined): Anchor | null {
    if (!drawer || drawer.hidden) return null;
    const y = drawerTopY(drawer);
    const kids = drawer.querySelector('.cmap-detail')?.children ?? [];
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect();
      if (r.bottom > y) return { el: kids[i] as HTMLElement, offset: r.top - y, height: r.height, index: i };
    }
    return null;
  }

  // Scroll the drawer so `el` (part of the detail) sits `offset` below its
  // top; a negative offset scales with el's change in height, as in the list.
  function revealInDrawer(drawer: HTMLElement | null, a: Anchor) {
    if (!drawer || drawer.hidden || !drawer.contains(a.el)) return;
    const r = a.el.getBoundingClientRect();
    const offset = a.offset < 0 && a.height > 0 ? a.offset * (r.height / a.height) : a.offset;
    drawer.scrollTop += r.top - drawerTopY(drawer) - offset;
  }

  // Put `el` back `offset` below the visible top. When it is partly scrolled
  // past (offset < 0) and its height changed (the plots go from 2 × 2 to one
  // row), keep the same share of it scrolled past instead of the same pixels.
  function alignTo(el: HTMLElement, offset: number, height = 0) {
    const r = el.getBoundingClientRect();
    if (offset < 0 && height > 0) offset *= r.height / height;
    const delta = r.top - visibleTop() - offset;
    if (Math.abs(delta) < 1) return;
    if (paneScrolls()) root.scrollTop += delta;
    else window.scrollBy(0, delta);
  }

  let anchor = findAnchor();
  let frozen: { anchor: Anchor | null; drawerTop: Anchor | null } | null = null;
  // Saved at once, at most every 50 ms, plus once after the last event.
  // Not with requestAnimationFrame or only a timer: both are paused or
  // slowed in background windows, which would leave a stale anchor.
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  let last = Number.NEGATIVE_INFINITY;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = 0;
    last = performance.now();
    anchor = findAnchor();
  };
  const later = () => {
    if (frozen) return;
    if (performance.now() - last > 50) save();
    else if (!timer) timer = setTimeout(save, 50);
  };
  function freeze(drawer?: HTMLElement | null) {
    if (timer) clearTimeout(timer);
    timer = 0;
    frozen = { anchor, drawerTop: drawerAnchor(drawer) };
  }

  function restore(moved: DetailMove | null, ctx: RestoreContext) {
    const before = frozen?.anchor ?? anchor;
    const drawerTop = frozen?.drawerTop ?? null;
    const row = ctx.openRow;
    if (moved && row && ctx.tab === 'browse') {
      if (moved.to === 'inline') {
        // From the drawer into the list: show the part that was at the
        // top of the drawer (or the row, with the detail under it).
        const detail = row.closest('.cmap-item')?.querySelector('.cmap-panel .cmap-detail');
        const top = drawerTop && inDetail(drawerTop, detail);
        if (top) alignTo(top.el, top.offset, top.height);
        else alignTo(row, 0);
      } else if (before?.index !== undefined) {
        // Into the drawer: show there the part that was on screen, and
        // keep its row in view in the list.
        const part = inDetail(before, ctx.drawer?.querySelector('.cmap-detail'));
        if (part) revealInDrawer(ctx.drawer, part);
        alignTo(row, 0);
      } else if (before?.el.isConnected) alignTo(before.el, before.offset, before.height);
    } else if (before?.el.isConnected) {
      alignTo(before.el, before.offset, before.height);
    }
    frozen = null;
    save();
  }

  // Scrolling, and clicks or folds that change the layout without a scroll.
  root.addEventListener('scroll', later, { passive: true });
  window.addEventListener('scroll', later, { passive: true });
  root.addEventListener('click', later);
  root.addEventListener('toggle', later, true);

  function dispose() {
    if (timer) clearTimeout(timer);
    timer = 0;
    root.removeEventListener('scroll', later);
    window.removeEventListener('scroll', later);
    root.removeEventListener('click', later);
    root.removeEventListener('toggle', later, true);
  }

  return { save, later, freeze, restore, alignTo, dispose };
}

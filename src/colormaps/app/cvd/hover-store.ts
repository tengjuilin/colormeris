import { useSyncExternalStore } from 'react';

// The pixel under the pointer, shared by the five panels' marks and the readout.
// An external store, so moving the pointer re-renders only the marks and the
// readout, not the figures.

export interface HoverPixel {
  x: number;
  y: number;
}

export interface HoverStore {
  get: () => HoverPixel | null;
  /** Ignores a pixel equal to the current one. */
  set: (p: HoverPixel | null) => void;
  subscribe: (fn: () => void) => () => void;
}

export function createHoverStore(): HoverStore {
  let cur: HoverPixel | null = null;
  const subs = new Set<() => void>();
  return {
    get: () => cur,
    set(p) {
      if (p === cur || (p && cur && p.x === cur.x && p.y === cur.y)) return;
      cur = p;
      for (const fn of subs) fn();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useHover(store: HoverStore): HoverPixel | null {
  return useSyncExternalStore(store.subscribe, store.get);
}

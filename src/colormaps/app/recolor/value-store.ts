import { useSyncExternalStore } from 'react';

// A small external store, so the hover can update the readout and the strips'
// marks without rendering the whole tab. `set` ignores a value equal to the current one.

export interface ValueStore<T> {
  get: () => T;
  set: (next: T) => void;
  subscribe: (fn: () => void) => () => void;
}

export function createValueStore<T>(initial: T, same: (a: T, b: T) => boolean = Object.is): ValueStore<T> {
  let cur = initial;
  const subs = new Set<() => void>();
  return {
    get: () => cur,
    set(next) {
      if (same(cur, next)) return;
      cur = next;
      for (const fn of subs) fn();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useStoreValue<T>(store: ValueStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

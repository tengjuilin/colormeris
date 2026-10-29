// The bridge between the imperative workspace and React: a version counter that is bumped whenever the
// sidebar state may have changed. Project objects are mutated in place, so components subscribe to the
// number (useWorkspace) and read the objects during render. See docs/react.md §1 and §8.
import { flushSafely } from '../../ui/flush.ts';

let version = 0;
const subs = new Set<() => void>();

export const store = {
  subscribe(fn: () => void) {
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  },
  getVersion: () => version,
};

/**
 * Tell React that the workspace changed. A full notify renders at once (`flushSync`), so imperative callers
 * such as `changed(); focusTick(id)` find the DOM current. A light one (every keystroke or handle drag)
 * lets React batch the render into a microtask. Never call it from a render or an effect. If a full notify
 * arrives while a flush is already running (a subscriber or a layout effect calling changed()), it is
 * deferred to a microtask instead of nesting flushSync.
 */
export function notify({ light = false }: { light?: boolean } = {}) {
  version++;
  const run = () => {
    for (const fn of [...subs]) fn();
  };
  if (light) run();
  else if (!flushSafely(run)) queueMicrotask(() => flushSafely(run));
}

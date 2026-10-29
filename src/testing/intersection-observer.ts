import { vi } from 'vitest';

// A stand-in for IntersectionObserver (jsdom has none), for tests of the lazy
// Browse rows: the test decides when an element "comes near the viewport".
// Call `unstub()` (or vi.unstubAllGlobals) when done.

export function stubIntersectionObserver() {
  const observed = new Set<Element>();
  let callback: IntersectionObserverCallback | null = null;
  class FakeObserver {
    constructor(cb: IntersectionObserverCallback) {
      callback = cb;
    }
    observe(el: Element) {
      observed.add(el);
    }
    unobserve(el: Element) {
      observed.delete(el);
    }
    disconnect() {
      observed.clear();
    }
  }
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  return {
    observed,
    /** The element comes into view: the observer reports it, as the browser would. */
    intersect(el: Element) {
      callback?.([{ target: el, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    },
    unstub: () => vi.unstubAllGlobals(),
  };
}

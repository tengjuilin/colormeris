import { type RefObject, useEffect, useState } from 'react';

// True once a row has come near the viewport (400 px margin) or is forced
// (opened, or revealed from a link). It stays true: a built row never goes
// back to a shell. One IntersectionObserver is shared by all rows, so 1000+
// rows cost one observer, not one each. Without IntersectionObserver every row
// is visible at once.

const callbacks = new Map<Element, () => void>();
let observer: IntersectionObserver | null = null;

function shared(): IntersectionObserver | null {
  if (observer || typeof IntersectionObserver === 'undefined') return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const cb = callbacks.get(e.target);
        if (!cb) continue;
        callbacks.delete(e.target);
        observer?.unobserve(e.target);
        cb();
      }
    },
    { rootMargin: '400px 0px' },
  );
  return observer;
}

/** For tests: forget the shared observer (the next row creates a new one). */
export function resetRowObserverForTests() {
  observer?.disconnect();
  observer = null;
  callbacks.clear();
}

export function useRowVisible(ref: RefObject<Element | null>, force: boolean): boolean {
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  if (force && !seen) setSeen(true); // adjusting state during render: built before the first paint
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = shared();
    if (!io) return;
    callbacks.set(el, () => setSeen(true));
    io.observe(el);
    return () => {
      callbacks.delete(el);
      io.unobserve(el);
    };
  }, [seen, ref]);
  return seen;
}

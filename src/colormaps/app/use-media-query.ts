import { useCallback, useEffect, useState } from 'react';

// A CSS media query as state. The setter lets the resize handler force the
// value (see use-scroll-anchor.ts): a `change` event can arrive after the
// resize event, or not at all while the window is in the background.

const matches = (q: string): boolean => typeof window.matchMedia === 'function' && window.matchMedia(q).matches;

export function useMediaQuery(query: string): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => matches(query));
  const set = useCallback((v: boolean) => setOn(v), []);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setOn(mql.matches);
    mql.addEventListener('change', onChange);
    onChange(); // it may have changed between the first render and now
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return [on, set];
}

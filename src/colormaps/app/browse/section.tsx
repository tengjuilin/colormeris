import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { userOpenOf } from './open-state.ts';

// The folding boxes of the Browse list: a section (Sequential, Diverging, …)
// holds sub-headings, and a sub-heading holds the rows. Both are uncontrolled
// <details>: the browser toggles them and the user's choice is remembered per
// element (open-state.ts). While a search or filter is on, a box is open when
// it has matches and shows "n of total"; when it is cleared the user's choice
// comes back. "Expand all" / "Collapse all" arrive as `foldCmd`; a repeat has
// a new `n`.

export interface FoldCmd {
  open: boolean;
  n: number;
}

interface FoldProps {
  title: string;
  total: number;
  /** Maps shown by the search and filters (all of them when none is on). */
  shownCount: number;
  filtering: boolean;
  foldCmd: FoldCmd | null;
  children: ReactNode;
}

function useFold(startOpen: boolean, { filtering, shownCount, foldCmd }: FoldProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const filteringRef = useRef(filtering);
  filteringRef.current = filtering;
  const lastFold = useRef(foldCmd?.n ?? 0);
  const hasMatches = shownCount > 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the triggers; the rest is read when they fire
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (foldCmd && foldCmd.n !== lastFold.current) {
      lastFold.current = foldCmd.n;
      if (!d.hidden) {
        d.open = foldCmd.open;
        userOpenOf.set(d, foldCmd.open);
      }
      return;
    }
    d.open = filtering ? hasMatches : (userOpenOf.get(d) ?? startOpen);
  }, [filtering, hasMatches, foldCmd?.n]);
  // Remember what the user chose, to restore it when a search is cleared.
  const onToggle = () => {
    const d = ref.current;
    if (d && !filteringRef.current) userOpenOf.set(d, d.open);
  };
  return { ref, onToggle };
}

const countText = (p: FoldProps) => (p.filtering ? `${p.shownCount} of ${p.total}` : String(p.total));

export function Section(p: FoldProps & { group: string }) {
  const { ref, onToggle } = useFold(false, p);
  return (
    <details
      className="cmap-section"
      id={`cmap-sec-${p.group}`}
      ref={ref}
      hidden={p.shownCount === 0}
      onToggle={onToggle}
    >
      <summary>
        <h2>{p.title}</h2>
        <span className="cmap-count">{countText(p)}</span>
      </summary>
      {p.children}
    </details>
  );
}

/** `startOpen`: Matplotlib's sub-headings, and in Sequential only the perceptually uniform ones. */
export function Sub(p: FoldProps & { startOpen: boolean }) {
  const { ref, onToggle } = useFold(p.startOpen, p);
  return (
    // `open` is set once here and then belongs to the browser and useFold (never re-rendered with another value).
    <details className="cmap-sub" ref={ref} open={p.startOpen} hidden={p.shownCount === 0} onToggle={onToggle}>
      <summary>
        <h3>{p.title}</h3>
        <span className="cmap-count">{countText(p)}</span>
      </summary>
      {p.children}
    </details>
  );
}

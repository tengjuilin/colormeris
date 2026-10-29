import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import type { Tree } from './browse-model.ts';
import { Row, type RowProps } from './row.tsx';
import { type FoldCmd, Section, Sub } from './section.tsx';

// The Browse list: the folding sections, their sub-headings and the rows, and
// "No colormap matches" when a search leaves nothing. `order` holds each
// sub-heading's maps in the current sort, so a sort only moves rows. The thin
// outer component owns `hidden` (flipped by every tab change); the sections
// below it are memoised and do not see it.

/** The key of a sub-heading in `order`: the same text can head a sub in two sections. */
export const subKey = (group: string, sub: string) => `${group}\n${sub}`;

export interface BrowseListProps {
  hidden: boolean;
  tree: Tree;
  order: ReadonlyMap<string, string[]>;
  /** Names shown by the search and filters, or null when none is on. */
  shown: ReadonlySet<string> | null;
  filtering: boolean;
  rowProps: (name: string) => RowProps;
  foldCmd: FoldCmd | null;
  /** The label for the Expand / Collapse button after the folds changed. */
  onFoldsChanged: (label: string) => void;
}

// The rows of one sub-heading, apart from its counts: a search changes the counts of every sub-heading,
// and this keeps it from creating a thousand row elements to find that no row changed.
const SubRows = memo(function SubRows({
  names,
  rowProps,
}: {
  names: readonly string[];
  rowProps: (name: string) => RowProps;
}) {
  return names.map((name) => <Row key={name} {...rowProps(name)} />);
});

const Sections = memo(function Sections({
  tree,
  order,
  shown,
  filtering,
  rowProps,
  foldCmd,
}: Omit<BrowseListProps, 'hidden' | 'onFoldsChanged'>) {
  let shownSections = 0;
  const sections = tree.map((sec) => {
    let sectionTotal = 0;
    let sectionShown = 0;
    const subs = sec.subs.map((s) => {
      const names = order.get(subKey(sec.group, s.sub)) ?? s.names;
      const n = shown ? s.names.reduce((k, name) => k + (shown.has(name) ? 1 : 0), 0) : s.names.length;
      sectionTotal += s.names.length;
      sectionShown += n;
      return (
        <Sub
          key={s.sub}
          title={s.sub}
          startOpen={s.startOpen}
          total={s.names.length}
          shownCount={n}
          filtering={filtering}
          foldCmd={foldCmd}
        >
          <SubRows names={names} rowProps={rowProps} />
        </Sub>
      );
    });
    if (sectionShown > 0) shownSections++;
    return (
      <Section
        key={sec.group}
        group={sec.group}
        title={sec.title}
        total={sectionTotal}
        shownCount={sectionShown}
        filtering={filtering}
        foldCmd={foldCmd}
      >
        {subs}
      </Section>
    );
  });
  return (
    <>
      {sections}
      <p className="muted" hidden={shownSections > 0}>
        No colormap matches your search.
      </p>
    </>
  );
});

export const BrowseList = memo(function BrowseList({ hidden, onFoldsChanged, ...rest }: BrowseListProps) {
  const list = useRef<HTMLDivElement>(null);
  // The search and filters hide rows. This is set on the DOM here, not through a prop of every row: a
  // keystroke would render over a thousand rows to flip an attribute, and the old list did exactly that
  // and nothing more. Rows never set `hidden` themselves, so React leaves it alone. Names are unique
  // ignoring case (a test says so), which `data-name` relies on.
  const { shown } = rest;
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const lower = shown && new Set([...shown].map((n) => n.toLowerCase()));
    for (const item of el.querySelectorAll<HTMLElement>('.cmap-item')) {
      const hide = lower ? !lower.has(item.dataset.name as string) : false;
      if (item.hidden !== hide) item.hidden = hide;
    }
  }, [shown]);
  const report = useRef(onFoldsChanged);
  report.current = onFoldsChanged;
  // Folds change by the user's click, a search and Expand all: the button names what a click would do.
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const sync = () => {
      const folds = [...el.querySelectorAll<HTMLDetailsElement>('.cmap-section, .cmap-sub')].filter((d) => !d.hidden);
      report.current(folds.every((d) => d.open) ? 'Collapse all' : 'Expand all');
    };
    el.addEventListener('toggle', sync, true);
    return () => el.removeEventListener('toggle', sync, true);
  }, []);
  return (
    <div className="cmap-browse" ref={list} hidden={hidden}>
      <Sections {...rest} />
    </div>
  );
});

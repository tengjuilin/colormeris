// The Panels card: chips for the panels on this page, links to other pages that have panels, add and delete
// buttons and the active panel's name. It reads the project during render (useWorkspace re-renders it on every
// workspace change) and writes through ws / w like the old imperative code did. This is the pattern for the
// other migrated cards: read in render, mutate in event handlers followed by ws.changed(), and move focus in a
// layout effect after the render that shows the thing to focus.
import { useLayoutEffect, useRef } from 'react';
import type { Panel } from '../../../types/index.ts';
import { BoundInput, CardHead, Chip, ChipList, Field, IconBtn } from '../../../ui/index.ts';
import { useBoundText } from '../../react/use-bound.ts';
import { useWorkspace } from '../../react/use-workspace.ts';

type Dot = 'pending' | 'done' | 'rejected';

/** Page number → names of its panels, for the panels not on `page`, in page order. */
export function otherPages(panels: Panel[], page: number): [page: number, names: string[]][] {
  const byPage = new Map<number, string[]>();
  for (const p of panels) {
    if (p.page === page) continue;
    byPage.set(p.page, [...(byPage.get(p.page) ?? []), p.name || '(unnamed)']);
  }
  return [...byPage.entries()].sort((a, b) => a[0] - b[0]);
}

export function PanelsCard() {
  const { ws, w } = useWorkspace({ section: 'sec-panels' });
  const { app } = w;
  const active = w.activePanel();
  const here = w.pagePanels();
  const page = w.currentPage();
  const multiPage = (app.project.source?.pageCount || 1) > 1;
  const others = otherPages(app.project.panels, page);
  const deleteLabel = here.length < 2 ? 'Clear the panel' : 'Delete the panel';

  // Set by Add; the layout effect after the render that shows the new panel focuses its name.
  const nameEl = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const focusName = useRef(false);
  useLayoutEffect(() => {
    if (!focusName.current) return;
    focusName.current = false;
    nameEl.current?.focus();
    nameEl.current?.select();
  });

  const rename = useBoundText((panel, value) => {
    panel.name = value;
  });

  // Handlers read the live project, not what this render captured.
  function select(p: Panel) {
    if (p.id === app.project.activePanelId) return;
    w.setMode(null);
    app.project.activePanelId = p.id;
    app.tableCell = null;
    w.changed();
  }

  function add() {
    focusName.current = true;
    try {
      w.addPanel();
    } catch (err) {
      focusName.current = false;
      throw err;
    }
  }

  function remove() {
    const panel = w.activePanel();
    const last = w.pagePanels().length < 2;
    const ok = confirm(
      last ? `Clear panel "${panel.name}"? A page always keeps one panel.` : `Delete panel "${panel.name}"?`,
    );
    if (ok) w.removePanel(panel);
  }

  function status(p: Panel): { dot: Dot; title: string } {
    const problem = w.toolFor(p).panelProblem(p);
    if (problem) return { dot: 'pending', title: problem };
    const review = ws.reviewStatus?.(p);
    if (review === 'rejected')
      return { dot: 'rejected', title: `Rejected in review${p.review?.note ? `: ${p.review.note}` : ''}` };
    return { dot: 'done', title: review === 'accepted' ? 'Calibrated and accepted' : 'Calibrated' };
  }

  return (
    <>
      <CardHead
        title={
          <>
            Panels{' '}
            <span id="panel-page-note" className="head-note">
              {multiPage ? `on page ${page}` : ''}
            </span>
          </>
        }
        actions={
          <>
            <IconBtn id="panel-add" icon="plus" label="Add a panel" onClick={add} />
            <IconBtn id="panel-delete" variant="danger" icon="trash" label={deleteLabel} onClick={remove} />
          </>
        }
      />
      <ChipList id="panel-list">
        {here.map((p) => (
          <Chip key={p.id} pressed={p === active} {...status(p)} onClick={() => select(p)}>
            {p.name || '(unnamed)'}
          </Chip>
        ))}
      </ChipList>
      <div id="other-pages" className="other-pages" hidden={others.length === 0}>
        <span className="hint">Other pages:</span>
        {others.map(([n, names]) => (
          <Chip key={n} title={`Go to page ${n}`} onClick={() => void w.goToPage(n)}>
            {`Page ${n}: ${names.join(', ')}`}
          </Chip>
        ))}
      </div>
      <Field label="Name">
        <BoundInput key={active.id} id="panel-name" ref={nameEl} spellCheck={false} value={active.name} {...rename} />
      </Field>
    </>
  );
}

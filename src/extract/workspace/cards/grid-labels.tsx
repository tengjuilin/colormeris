// The Grid card's label editors: row and column labels with Read labels with AI (heatmap), and the box names
// (ROI). A pasted list that does not match the grid size offers to resize the grid, as it always has.

import { DEFAULT_LABELS_MODEL } from '../../../agent/labels.ts';
import { labelsModelFocused, labelsReaderState, readLabels, setLabelsModel } from '../../../agent/ui/labels-reader.ts';
import { BoundInput, Field, Hint, MainStep, Options, useSettings } from '../../../ui/index.ts';
import { parseLabelText } from '../../project/project.ts';
import { useBoundText } from '../../react/use-bound.ts';
import { useWorkspace } from '../../react/use-workspace.ts';

const READ_TITLE =
  'Send the current view to a vision LLM (Agent card, Label reader) and fill in both lists for this panel. Zoom so the grid and its labels are visible.';

export function LabelOptions({ hidden }: { hidden: boolean }) {
  const { w } = useWorkspace({ section: 'sec-grid' });
  const { settings } = useSettings();
  const active = w.activePanel();
  const g = active.grid;
  const { busy, hint, error } = labelsReaderState();

  const rowLabels = useBoundText((p, v) => {
    p.grid.rowLabels = parseLabelText(v);
  });
  const colLabels = useBoundText((p, v) => {
    p.grid.colLabels = parseLabelText(v);
  });

  // After a pasted list is committed: the grid keeps its size unless the user agrees to match the list.
  function offerSize(key: 'rows' | 'cols') {
    const p = w.activePanel();
    const labels = key === 'rows' ? p.grid.rowLabels : p.grid.colLabels;
    if (
      labels.length > 1 &&
      labels.length !== p.grid[key] &&
      confirm(`Set ${key} to ${labels.length} to match the labels?`)
    ) {
      w.commit((pn) => {
        pn.grid[key] = labels.length;
      });
    }
  }

  return (
    <Options
      hidden={hidden}
      summary="Row and column labels"
      note={g.rowLabels.length || g.colLabels.length ? 'custom' : 'R1…, C1…'}
    >
      <MainStep
        id="grid-read-labels"
        variant="primary"
        icon="ai"
        title={READ_TITLE}
        disabled={!g.corners || busy}
        onClick={() => void readLabels()}
      >
        {busy ? 'Reading…' : 'Read labels with AI'}
      </MainStep>
      <Field
        label="Model"
        title="OpenRouter model id; needs vision and tools. Key and base URL are the Agent's (Settings → Agent)."
      >
        <BoundInput
          id="agent-labels"
          list="agent-llm-list"
          spellCheck={false}
          value={settings.agent.labels || DEFAULT_LABELS_MODEL}
          onFocus={labelsModelFocused}
          onCommit={setLabelsModel}
        />
      </Field>
      <Hint id="grid-read-labels-hint" className={error ? 'error' : undefined}>
        {hint}
      </Hint>
      <Field stack label="Rows (top → bottom)">
        <BoundInput
          key={active.id}
          id="grid-row-labels"
          kind="textarea"
          rows={3}
          spellCheck={false}
          placeholder="One per line or comma-separated; blank = R1, R2, …"
          value={g.rowLabels.join('\n')}
          {...rowLabels}
          onCommit={() => {
            rowLabels.onCommit();
            offerSize('rows');
          }}
        />
      </Field>
      <Field stack label="Columns (left → right)">
        <BoundInput
          key={active.id}
          id="grid-col-labels"
          kind="textarea"
          rows={3}
          spellCheck={false}
          placeholder="One per line or comma-separated; blank = C1, C2, …"
          value={g.colLabels.join('\n')}
          {...colLabels}
          onCommit={() => {
            colLabels.onCommit();
            offerSize('cols');
          }}
        />
      </Field>
    </Options>
  );
}

export function BoxNameOptions({ hidden }: { hidden: boolean }) {
  const { w } = useWorkspace({ section: 'sec-grid' });
  const active = w.activePanel();
  const names = active.grid.boxLabels;
  const bind = useBoundText((p, v) => {
    p.grid.boxLabels = parseLabelText(v);
  });
  return (
    <Options hidden={hidden} summary="Box names" note={names.length ? `${names.length} names` : 'R1 C1, …'}>
      <Field stack label="Box names, left → right, top → bottom">
        <BoundInput
          key={active.id}
          id="grid-box-labels"
          kind="textarea"
          rows={3}
          spellCheck={false}
          placeholder="One per line or comma-separated, e.g. B-a11, B-a16, C-a9 …; blank = R1 C1, R1 C2, …"
          value={names.join('\n')}
          {...bind}
        />
      </Field>
    </Options>
  );
}

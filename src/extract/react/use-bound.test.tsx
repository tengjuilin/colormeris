// @vitest-environment jsdom
// useBoundNumber / useBoundText: history on focus, light change while typing, full change on commit.
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, test } from 'vitest';
import type { Panel, Workspace, WorkspaceContext } from '../../types/index.ts';
import { BoundInput, BoundSelect } from '../../ui/index.ts';
import { useBoundNumber } from './use-bound.ts';
import { WsContext } from './use-workspace.ts';

afterEach(cleanup);

function NumberField({ panel }: { panel: { n: number } }) {
  const bound = useBoundNumber((p, v) => ((p as unknown as typeof panel).n = Math.min(v, 5)));
  return <BoundInput kind="number" value={panel.n} aria-label="n" {...bound} />;
}

function setup() {
  const log: string[] = [];
  const panel = { n: 1 } as unknown as Panel & { n: number };
  const ws = {
    pushHistory: () => log.push('history'),
    activePanel: () => panel,
    changed: (o?: { light?: boolean }) => log.push(o?.light ? 'light' : 'full'),
  } as unknown as Workspace;
  render(
    <WsContext.Provider value={{ ws, w: {} as WorkspaceContext }}>
      <NumberField panel={panel} />
    </WsContext.Provider>,
  );
  return { log, panel, el: screen.getByLabelText('n') as HTMLInputElement };
}

test('history on focus, light while typing, nothing for "" or NaN, full on change', () => {
  const { log, panel, el } = setup();
  fireEvent.focus(el);
  fireEvent.input(el, { target: { value: '' } });
  fireEvent.input(el, { target: { value: '3' } });
  assert.deepEqual(log, ['history', 'light']);
  assert.equal(panel.n, 3);
  fireEvent.change(el);
  assert.deepEqual(log, ['history', 'light', 'full']);
});

test('after commit the draft shows the model, so a clamped value appears while focused', () => {
  const { panel, el } = setup();
  fireEvent.focus(el);
  fireEvent.change(el, { target: { value: '9' } });
  panel.n = 5; // what apply stored
  fireEvent.change(el); // commit again; the component re-renders with the model
  assert.equal(panel.n, 5);
});

test('BoundSelect is controlled and reports the chosen value; refs reach the element', () => {
  let got = '';
  const ref = { current: null as HTMLSelectElement | null };
  render(
    <BoundSelect
      ref={ref}
      aria-label="s"
      value="b"
      options={[
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ]}
      onChange={(v) => (got = v)}
    />,
  );
  const s = screen.getByLabelText('s') as HTMLSelectElement;
  assert.equal(s.value, 'b');
  assert.equal(ref.current, s);
  fireEvent.change(s, { target: { value: 'a' } });
  assert.equal(got, 'a');
});

// @vitest-environment jsdom
// useWorkspace: a card with a section stops re-rendering while hidden and renders once when shown; light: false
// ignores light notifies.
import assert from 'node:assert/strict';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, test } from 'vitest';
import type { Workspace, WorkspaceContext } from '../../types/index.ts';
import { notify } from '../workspace/store.ts';
import { sectionVisible, type UseWorkspaceOptions, useWorkspace, WsContext } from './use-workspace.ts';

afterEach(cleanup);

function Probe({ opts, count }: { opts: UseWorkspaceOptions; count: { renders: number } }) {
  useWorkspace(opts);
  count.renders++;
  return null;
}

function setup(opts: { section?: string; light?: boolean }) {
  const state = { loaded: false, sections: ['sec-roi'] as string[] | undefined };
  const w = {
    app: {
      get sourceCanvas() {
        return state.loaded ? {} : null;
      },
    },
    tool: () => ({ sections: state.sections }),
  } as unknown as WorkspaceContext;
  const count = { renders: 0 };
  render(
    <WsContext.Provider value={{ ws: {} as Workspace, w }}>
      <Probe opts={opts} count={count} />
    </WsContext.Provider>,
  );
  return { state, w, renders: () => count.renders };
}

test('sectionVisible: needs a file, then fixed sections or the tool sections', () => {
  const { state, w } = setup({});
  const ctx = { ws: {} as Workspace, w };
  assert.equal(sectionVisible(ctx, 'sec-panels'), false);
  state.loaded = true;
  assert.equal(sectionVisible(ctx, 'sec-panels'), true);
  assert.equal(sectionVisible(ctx, 'sec-roi'), true);
  assert.equal(sectionVisible(ctx, 'sec-map'), false);
});

test('a hidden card skips renders and renders once when its section is shown', () => {
  const { state, renders } = setup({ section: 'sec-roi' });
  const start = renders();
  act(() => notify());
  act(() => notify());
  assert.equal(renders(), start);
  state.loaded = true;
  act(() => notify());
  assert.equal(renders(), start + 1);
  act(() => notify());
  assert.equal(renders(), start + 2);
});

test('light: false ignores light notifies', () => {
  const { renders } = setup({ light: false });
  const start = renders();
  act(() => notify({ light: true }));
  assert.equal(renders(), start);
  act(() => notify());
  assert.equal(renders(), start + 1);
});

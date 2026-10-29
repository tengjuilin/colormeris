// @vitest-environment jsdom
// The resize handler: freeze, change the layout (setWide, flushed before the
// handler goes on), restore with the direction the open detail moved.
import assert from 'node:assert/strict';
import { cleanup, render } from '@testing-library/react';
import { StrictMode, useMemo, useRef, useState } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { useScrollAnchor } from './use-scroll-anchor.ts';

const calls: string[] = [];
const restore = vi.fn();
const dispose = vi.fn();
vi.mock('../scroll-anchor.ts', () => ({
  createScrollAnchor: () => ({
    save: () => {},
    later: () => {},
    freeze: () => calls.push('freeze'),
    restore: (...a: unknown[]) => {
      calls.push('restore');
      restore(...a);
    },
    alignTo: () => {},
    dispose,
  }),
}));

let matches = false;
beforeEach(() => {
  calls.length = 0;
  restore.mockClear();
  dispose.mockClear();
  matches = false;
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Harness({ openRow, initialWide = false }: { openRow: HTMLElement | null; initialWide?: boolean }) {
  const [wide, setWide] = useState(initialWide);
  const root = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const refs = useMemo(() => ({ root, top, drawer }), []);
  useScrollAnchor({
    refs,
    getOpenRow: () => openRow,
    tab: 'browse',
    wide,
    setWide: (v) => {
      calls.push(`setWide(${v})`);
      setWide(v);
    },
  });
  calls.push(`render(${wide})`);
  return (
    <div ref={root}>
      <div ref={top} />
      <aside ref={drawer} />
    </div>
  );
}
const mount = (openRow: HTMLElement | null, initialWide = false) =>
  render(
    <StrictMode>
      <Harness openRow={openRow} initialWide={initialWide} />
    </StrictMode>,
  );
const resize = () => window.dispatchEvent(new Event('resize'));

test('narrow to wide with a map open: freeze, setWide flushed (rendered before restore), restore with the move', () => {
  const row = document.createElement('div');
  mount(row, false);
  matches = true;
  calls.length = 0;
  resize();
  const at = (c: string) => calls.indexOf(c);
  assert.ok(at('freeze') >= 0 && at('freeze') < at('setWide(true)'));
  assert.ok(at('setWide(true)') < at('render(true)'), 'the render happened inside the handler');
  assert.ok(at('render(true)') < at('restore'), 'restore measures the new layout');
  assert.deepEqual(restore.mock.calls[0][0], { from: 'inline', to: 'drawer' });
  assert.equal(restore.mock.calls[0][1].openRow, row);
  assert.equal(restore.mock.calls[0][1].tab, 'browse');
});

test('wide to narrow moves the other way', () => {
  mount(document.createElement('div'), true);
  matches = false;
  resize();
  assert.deepEqual(restore.mock.calls[0][0], { from: 'drawer', to: 'inline' });
});

test('no move when nothing is open or the layout did not change', () => {
  mount(null, false);
  matches = true;
  resize();
  assert.equal(restore.mock.calls[0][0], null, 'nothing open');
  cleanup();
  restore.mockClear();
  mount(document.createElement('div'), false);
  matches = false;
  resize();
  assert.equal(restore.mock.calls[0][0], null, 'same layout');
});

test('widening past 820px with the document scrolled goes to the top first', () => {
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(window, 'scrollY', 'get').mockReturnValue(300);
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(900);
  mount(null);
  resize();
  assert.deepEqual(scrollTo.mock.calls[0], [0, 0]);
});

test('unmount removes the handler and disposes the anchor', () => {
  const { unmount } = mount(null);
  unmount();
  assert.ok(dispose.mock.calls.length >= 1);
  restore.mockClear();
  resize();
  assert.equal(restore.mock.calls.length, 0);
});

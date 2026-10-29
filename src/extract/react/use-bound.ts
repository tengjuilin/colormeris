// Workspace wrappers for BoundInput, replacing bindNumber / bindText: push history lazily (at the first
// edit after a focus, so focus and blur alone leave no undo entry), apply while typing with a light change,
// and do a full change on commit. Numbers that are empty or not finite are ignored
// while typing, as bindNumber does. Spread the result onto a BoundInput.

import { useRef } from 'react';
import type { Panel } from '../../types/index.ts';
import { parseNumber } from '../../ui/bound-input.tsx';
import { useWorkspace } from './use-workspace.ts';

export function useBoundNumber(
  apply: (panel: Panel, value: number) => void,
  opts: { accept?: (value: number) => boolean } = {},
) {
  const { ws } = useWorkspace();
  const pushed = useRef(false);
  return {
    onFocus: () => {
      pushed.current = false;
    },
    onInput: (text: string) => {
      const v = parseNumber(text);
      if (v === null || opts.accept?.(v) === false) return;
      if (!pushed.current) ws.pushHistory();
      pushed.current = true;
      apply(ws.activePanel(), v);
      ws.changed({ light: true });
    },
    onCommit: () => ws.changed(),
  };
}

export function useBoundText(apply: (panel: Panel, value: string) => void) {
  const { ws } = useWorkspace();
  const pushed = useRef(false);
  return {
    onFocus: () => {
      pushed.current = false;
    },
    onInput: (text: string) => {
      if (!pushed.current) ws.pushHistory();
      pushed.current = true;
      apply(ws.activePanel(), text);
      ws.changed({ light: true });
    },
    onCommit: () => ws.changed(),
  };
}

// Workspace wrappers for BoundInput, replacing bindNumber / bindText: push history on focus, apply while
// typing with a light change, and do a full change on commit. Numbers that are empty or not finite are ignored
// while typing, as bindNumber does. Spread the result onto a BoundInput.

import type { Panel } from '../../types/index.ts';
import { parseNumber } from '../../ui/bound-input.tsx';
import { useWorkspace } from './use-workspace.ts';

export function useBoundNumber(
  apply: (panel: Panel, value: number) => void,
  opts: { accept?: (value: number) => boolean } = {},
) {
  const { ws } = useWorkspace();
  return {
    onFocus: () => ws.pushHistory(),
    onInput: (text: string) => {
      const v = parseNumber(text);
      if (v === null || opts.accept?.(v) === false) return;
      apply(ws.activePanel(), v);
      ws.changed({ light: true });
    },
    onCommit: () => ws.changed(),
  };
}

export function useBoundText(apply: (panel: Panel, value: string) => void) {
  const { ws } = useWorkspace();
  return {
    onFocus: () => ws.pushHistory(),
    onInput: (text: string) => {
      apply(ws.activePanel(), text);
      ws.changed({ light: true });
    },
    onCommit: () => ws.changed(),
  };
}

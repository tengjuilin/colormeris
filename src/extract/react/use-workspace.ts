// React access to the workspace: the context carrying the public `ws` and the private `w`, and the hook that
// re-renders on every store notification. Components read the project during render (w.activePanel(),
// ws.tool(), ws.app.mode); never memoize on project objects, they are mutated in place.
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Workspace, WorkspaceContext } from '../../types/index.ts';
import { store } from '../workspace/store.ts';

export interface WsContextValue {
  ws: Workspace;
  w: WorkspaceContext;
}

export const WsContext = createContext<WsContextValue | null>(null);

export function useWorkspace(): WsContextValue {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error('useWorkspace needs a WsContext provider');
  useSyncExternalStore(store.subscribe, store.getVersion);
  return ctx;
}

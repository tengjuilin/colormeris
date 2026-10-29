// React access to the workspace: the context carrying the public `ws` and the private `w`, and the hook that
// re-renders on workspace notifications. Components read the project during render (w.activePanel(),
// w.tool(), w.app.mode); never memoize on project objects, they are mutated in place.
import { createContext, useContext, useRef, useSyncExternalStore } from 'react';
import type { Workspace, WorkspaceContext } from '../../types/index.ts';
import { store } from '../workspace/store.ts';

export interface WsContextValue {
  ws: Workspace;
  w: WorkspaceContext;
}

export const WsContext = createContext<WsContextValue | null>(null);

/** Sections shown for every tool once a file is loaded. */
const FIXED_SECTIONS = ['sec-panels', 'sec-grid', 'sec-colorbar'];

/** The rule renderSidebarDom applies to a section's `hidden`, without reading the DOM. */
export function sectionVisible({ w }: WsContextValue, sectionId: string): boolean {
  if (!w.app.sourceCanvas) return false;
  return FIXED_SECTIONS.includes(sectionId) || !!w.tool().sections?.includes(sectionId);
}

export interface UseWorkspaceOptions {
  /** The card's section id. While that section is hidden the card does not re-render; it renders once when shown. */
  section?: string;
  /** false: ignore light notifies (every keystroke or drag move); only full changes re-render. */
  light?: boolean;
}

export function useWorkspace({ section, light = true }: UseWorkspaceOptions = {}): WsContextValue {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error('useWorkspace needs a WsContext provider');
  // The snapshot is the version, frozen while the section is hidden. Visibility is decided inside the
  // snapshot, so a card that is not rendering still wakes up when its section becomes visible.
  const frozen = useRef(0);
  const snapshot = () => {
    if (section && !sectionVisible(ctx, section)) return frozen.current;
    return (frozen.current = light ? store.getVersion() : store.getFullVersion());
  };
  useSyncExternalStore(store.subscribe, snapshot);
  return ctx;
}

/** The workspace without subscribing: for hooks whose handlers only read live state (use-bound.ts). */
export function useWorkspaceContext(): WsContextValue {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error('useWorkspaceContext needs a WsContext provider');
  return ctx;
}

/** Whether a section is shown now (read during render, so use it in a card that subscribes with `section`). */
export function useSectionVisible(sectionId: string): boolean {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error('useSectionVisible needs a WsContext provider');
  return sectionVisible(ctx, sectionId);
}

import { createContext, type Dispatch, useContext } from 'react';
import type { ViewerAction, ViewerState } from './viewer-state.ts';

// The viewer's state and its dispatch as two contexts, so a component that only
// dispatches (the Browse rows' buttons, the controls) never re-renders when the
// state changes: `dispatch` from useReducer is stable.

export const ViewerStateContext = createContext<ViewerState | null>(null);
export const DispatchContext = createContext<Dispatch<ViewerAction> | null>(null);

export function useViewer(): ViewerState {
  const s = useContext(ViewerStateContext);
  if (!s) throw new Error('useViewer needs a ColormapsApp');
  return s;
}

export function useDispatch(): Dispatch<ViewerAction> {
  const d = useContext(DispatchContext);
  if (!d) throw new Error('useDispatch needs a ColormapsApp');
  return d;
}

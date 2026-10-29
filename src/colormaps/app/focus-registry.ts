import { createContext, useContext } from 'react';

// Where focus goes when the open detail is closed: the row's open button.
// Rows register their button here (by map name) and the shell focuses the one
// named by `returnTo` after the render that closed the detail. One stable
// object, so reading it from a context never re-renders anyone.

export interface FocusRegistry {
  buttons: Map<string, HTMLButtonElement>;
  /** The map whose button gets focus after the next render; the shell clears it. */
  returnTo: string | null;
}

export const createFocusRegistry = (): FocusRegistry => ({ buttons: new Map(), returnTo: null });

export const FocusRegistryContext = createContext<FocusRegistry>(createFocusRegistry());

export const useFocusRegistry = (): FocusRegistry => useContext(FocusRegistryContext);

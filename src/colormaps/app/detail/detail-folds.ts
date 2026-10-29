import { createContext, useContext } from 'react';

// Which folds of the detail view the user has opened ("Numbers", "Where values
// get confused", "References"). They stay open when another map is opened, and
// when the detail moves between the drawer and the inline panel (a remount),
// so the store lives outside the components. The default store is shared by
// the page; a provider (or a test) can hand out its own.

export interface DetailFolds {
  has(id: string): boolean;
  set(id: string, open: boolean): void;
  clear(): void;
}

export function createDetailFolds(): DetailFolds {
  const open = new Set<string>();
  return {
    has: (id) => open.has(id),
    set(id, on) {
      if (on) open.add(id);
      else open.delete(id);
    },
    clear: () => open.clear(),
  };
}

export const DetailFoldsContext = createContext<DetailFolds>(createDetailFolds());

export const useDetailFolds = (): DetailFolds => useContext(DetailFoldsContext);

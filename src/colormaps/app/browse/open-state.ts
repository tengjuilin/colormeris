// What the user chose for a folded section or sub-heading (open or closed),
// kept per <details> element. The folds are uncontrolled: the browser toggles
// them, a search opens the ones with matches, and clearing the search puts
// the user's choice back. A row revealed from a link sets its ancestors' choice
// to open, so it stays open after a search is cleared.
export const userOpenOf = new WeakMap<HTMLDetailsElement, boolean>();

// Map tool, profile selection rules (pure): which profiles are selected after a click and after the list changed. The selected
// profile (`selectedId`) is the one edited in the card; `overlay` holds more selected profiles plotted with it.
import type { Profile } from '../../types/index.ts';

export interface Selection {
  selectedId: string | null;
  overlay: Set<string>;
}

/**
 * Drops ids that no longer exist, promotes an overlay profile when the edited one is gone, and selects a
 * single profile so it is shown without clicking it first. Mutates `sel`; running it again changes nothing.
 */
export function reconcileSelection(sel: Selection, profiles: Profile[]) {
  const ids = new Set(profiles.map((l) => l.id));
  if (sel.selectedId && !ids.has(sel.selectedId)) sel.selectedId = null;
  for (const id of sel.overlay) if (!ids.has(id) || id === sel.selectedId) sel.overlay.delete(id);
  if (!sel.selectedId && sel.overlay.size) {
    sel.selectedId = [...sel.overlay].pop()!;
    sel.overlay.delete(sel.selectedId);
  }
  if (!sel.selectedId && profiles.length === 1) sel.selectedId = profiles[0].id;
}

/**
 * A click on profile `id` (null: on nothing). Without `add` it selects just that one; with `add` (Shift) it
 * toggles it: an unselected profile becomes the edited one and the previous one joins the overlay, and
 * deselecting the edited one promotes the last overlay profile. Mutates `sel`.
 */
export function selectInSet(sel: Selection, id: string | null, add = false) {
  if (!add || !id) {
    sel.selectedId = id;
    sel.overlay.clear();
  } else if (id === sel.selectedId || sel.overlay.has(id)) {
    sel.overlay.delete(id);
    if (sel.selectedId === id) {
      sel.selectedId = [...sel.overlay].pop() ?? null;
      if (sel.selectedId) sel.overlay.delete(sel.selectedId);
    }
  } else {
    if (sel.selectedId) sel.overlay.add(sel.selectedId);
    sel.selectedId = id;
  }
}

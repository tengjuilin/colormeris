// Moving the focus to a tick's value field after a tick was added. A caller names the tick (requestTickFocus or
// the workspace's focusTick); the tick table focuses it in a layout effect after the render that shows the row,
// and the request is dropped after that render, found or not, so it never fires later by surprise.
import type { ColorbarCardMembers, WorkspaceContext } from '../../../types/index.ts';

let pending: string | null = null;

export function requestTickFocus(id: string) {
  pending = id;
}

/** Forget a request whose action failed. */
export function cancelTickFocus() {
  pending = null;
}

/** Focus the requested tick's value field if its row is in the DOM; the request ends either way. */
export function flushTickFocus() {
  const id = pending;
  pending = null;
  if (!id) return;
  const input = document.querySelector<HTMLInputElement>(`#tick-list tr[data-id="${id}"] input`);
  input?.focus();
}

/**
 * `w.focusTick(id)` for interact.ts: called after a commit, so the row exists once the flush is done; if the
 * render was deferred, the request waits for it.
 */
export function setupWorkspaceTickFocus(_w: WorkspaceContext): ColorbarCardMembers {
  return {
    focusTick(id) {
      requestTickFocus(id);
      flushTickFocus();
      // Not in the DOM yet (render deferred): ask again so the next render's layout effect focuses it.
      if (!document.querySelector(`#tick-list tr[data-id="${id}"]`)) requestTickFocus(id);
    },
  };
}

// Moving the focus to a new axis tick's value field (kept apart from axes-card.tsx so that file exports only
// the component). A caller names the tick; the Axes card flushes the request in a layout effect.
import type { AxisKey } from '../field.ts';

// Moving the focus to a new tick's value field: the caller names the tick, the table focuses it in a layout
// effect after the render that shows the row; the request ends after that render, found or not.
let pendingFocus: { key: AxisKey; id: string } | null = null;

export function flushAxisTickFocus() {
  const p = pendingFocus;
  pendingFocus = null;
  if (p) document.querySelector<HTMLInputElement>(`#axis-${p.key}-ticks tr[data-id="${p.id}"] input`)?.focus();
}

/** Focus tick `id`'s value after a commit added it; waits for the render if the row is not there yet. */
export function focusAxisTick(key: AxisKey, id: string) {
  pendingFocus = { key, id };
  flushAxisTickFocus();
  if (!document.querySelector(`#axis-${key}-ticks tr[data-id="${id}"]`)) pendingFocus = { key, id };
}

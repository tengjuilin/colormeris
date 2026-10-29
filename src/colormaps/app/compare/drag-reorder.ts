// Pointer-based drag to reorder the rows of the comparison (works for touch
// too): the row follows the pointer and a line shows where it will land; the
// order changes on release. Imperative on purpose: it moves a row with a CSS
// transform on every pointer move, and React renders nothing until the drop.

/** The row slot the pointer is nearest to, given the rows' middles. */
export function nearestSlot(mids: number[], y: number): number {
  return mids.reduce((best, m, k) => (Math.abs(m - y) < Math.abs(mids[best] - y) ? k : best), 0);
}

/**
 * Starts a drag of `items[from]` from the grip that got `e`. Calls
 * `onDrop(from, to)` on release when the row landed elsewhere.
 */
export function startRowDrag(
  e: PointerEvent,
  grip: HTMLElement,
  items: HTMLElement[],
  from: number,
  onDrop: (from: number, to: number) => void,
) {
  if (e.button > 0) return;
  e.preventDefault();
  const item = items[from];
  if (!item) return;
  const mids = items.map((x) => {
    const r = x.getBoundingClientRect();
    return r.top + r.height / 2;
  });
  let to = from;
  grip.setPointerCapture?.(e.pointerId);
  item.classList.add('dragging');
  const mark = () =>
    items.forEach((x, k) => {
      x.classList.toggle('drop-before', k === to && to < from);
      x.classList.toggle('drop-after', k === to && to > from);
    });
  const move = (ev: PointerEvent) => {
    item.style.transform = `translateY(${ev.clientY - e.clientY}px)`;
    to = nearestSlot(mids, ev.clientY);
    mark();
  };
  const end = (ev: PointerEvent) => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', end);
    grip.removeEventListener('pointercancel', end);
    item.classList.remove('dragging');
    item.style.transform = '';
    for (const x of items) x.classList.remove('drop-before', 'drop-after');
    if (ev.type === 'pointerup' && to !== from) onDrop(from, to);
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

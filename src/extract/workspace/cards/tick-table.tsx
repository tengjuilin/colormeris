// The Colorbar card's tick table: one row per tick, keyed by tick id so a row keeps its input (and the focus)
// while ticks are added or removed around it. Each row has the tick's value, its position in % along the bar
// (editable for ticks whose mark is hard to click, e.g. at the very ends) and a remove button. Handlers look the
// tick up in the live project by id, because the render that made them may be old.
import { useLayoutEffect, useRef } from 'react';
import { pointAtT } from '../../../core/colorbar.ts';
import type { TickWithT, WorkspaceContext } from '../../../types/index.ts';
import { BoundInput, Btn } from '../../../ui/index.ts';
import { flushTickFocus } from './tick-focus.ts';

function TickRow({ w, tick: k }: { w: WorkspaceContext; tick: TickWithT }) {
  const pushed = useRef(false);
  const liveTick = () => w.activePanel().colorbar.ticks.find((x) => x.id === k.id);
  // History at the first edit after a focus, so focusing and leaving a field adds no undo step.
  const pushOnce = () => {
    if (!pushed.current) w.pushHistory();
    pushed.current = true;
  };
  const enterBlurs = (e: { key: string; currentTarget: HTMLElement }) => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  function setValue(text: string) {
    const tick = liveTick();
    if (!tick) return;
    pushOnce();
    tick.value = text === '' ? NaN : Number(text);
    w.changed({ light: true });
  }

  function setPosition(text: string) {
    const cb = w.activePanel().colorbar;
    const tick = liveTick();
    const v = Number(text);
    if (!tick || text === '' || !Number.isFinite(v)) return w.changed();
    const t = Math.min(110, Math.max(-10, v)) / 100;
    // A tick on the page moves along the bar; a typed one keeps just t.
    if (Number.isFinite(tick.x)) {
      if (!cb.start || !cb.end) return w.changed();
      pushOnce();
      Object.assign(tick, pointAtT(cb.start, cb.end, t));
    } else {
      pushOnce();
      tick.t = t;
    }
    w.changed();
  }

  const reset = () => {
    pushed.current = false;
  };
  return (
    <tr data-id={k.id} className={Number.isFinite(k.value) ? undefined : 'invalid'}>
      <td>
        <BoundInput
          kind="number"
          step="any"
          placeholder="value"
          value={Number.isFinite(k.value) ? k.value : ''}
          onFocus={reset}
          onInput={setValue}
          onCommit={() => w.changed()}
          onKeyDown={enterBlurs}
        />
      </td>
      <td className="pos">
        <BoundInput
          kind="number"
          step="any"
          min={-10}
          max={110}
          className="num"
          aria-label="Position in % along the colorbar"
          title="Position along the colorbar or colormap: 0% at the start, 100% at the end"
          value={Number.isFinite(k.t) ? Math.round(k.t * 1000) / 10 : ''}
          onFocus={reset}
          onCommit={setPosition}
          onKeyDown={enterBlurs}
        />
        %
      </td>
      <td>
        <Btn
          variant="subtle"
          className="icon"
          title="Remove tick"
          aria-label="Remove tick"
          onClick={() => w.commit((p) => (p.colorbar.ticks = p.colorbar.ticks.filter((x) => x.id !== k.id)))}
        >
          ×
        </Btn>
      </td>
    </tr>
  );
}

export function TickTable({ w, ticks }: { w: WorkspaceContext; ticks: TickWithT[] }) {
  // A tick was just added: focus its value once the row is in the DOM.
  useLayoutEffect(flushTickFocus);
  return (
    <table className="ticks" hidden={ticks.length === 0}>
      <thead>
        <tr>
          <th>Tick value</th>
          <th title="0% at the start of the colorbar (or colormap), 100% at its end">Position</th>
          <th />
        </tr>
      </thead>
      <tbody id="tick-list">
        {ticks.map((k) => (
          <TickRow key={k.id} w={w} tick={k} />
        ))}
      </tbody>
    </table>
  );
}

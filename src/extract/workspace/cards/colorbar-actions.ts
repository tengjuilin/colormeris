// What the Colorbar card's buttons and selects do, as functions of the workspace context w. They read the live
// project (not what a render captured), because hotkeys and `.click()` call the same handlers.
import { isLogScale, pointAtT } from '../../../core/colorbar.ts';
import type { Tick, WorkspaceContext } from '../../../types/index.ts';
import { ticksWithT } from '../../project/project.ts';
import { cancelTickFocus, requestTickFocus } from './tick-focus.ts';

/** B: leave the placing mode, or start it (after asking before dropping the ticks that sit on the old bar). */
export function placeColorbarEnds(w: WorkspaceContext) {
  const { app } = w;
  if (app.mode?.type === 'colorbar') return w.setMode(null);
  const cb = w.activePanel().colorbar;
  // Ticks typed along a known colormap do not depend on the bar and stay.
  const onPage = cb.ticks.filter((k) => Number.isFinite(k.x)).length;
  if (onPage && !confirm('Placing the colorbar again removes its ticks on the page. Continue?')) return;
  if (onPage) w.commit((p) => (p.colorbar.ticks = p.colorbar.ticks.filter((k) => !Number.isFinite(k.x))));
  w.setMode('colorbar');
}

/** T: toggle clicking ticks onto the bar. */
export function toggleTickMode(w: WorkspaceContext) {
  w.setMode(w.app.mode?.type === 'tick' ? null : 'tick');
}

// Pick a known colormap. A panel without ticks gets one at each end, valued
// 0 and 1 (1 and 10 on a log scale, which has no 0), so the panel reads
// values at once; typing the figure's range replaces them.
export function chooseColormap(w: WorkspaceContext, name: string, reversed: boolean) {
  const cb = w.activePanel().colorbar;
  const addEnds = !cb.ticks.length;
  const ids = addEnds ? [w.newTickId(), w.newTickId()] : [];
  const [lo, hi] = isLogScale(cb.scale) ? [1, 10] : [0, 1];
  // The first end's value gets the focus after the render that shows it.
  if (addEnds) requestTickFocus(ids[0]);
  try {
    w.commit((p) => {
      p.colorbar.colormap = { name, reversed: !!reversed };
      if (addEnds)
        p.colorbar.ticks = [
          { id: ids[0], t: 0, value: lo },
          { id: ids[1], t: 1, value: hi },
        ];
    });
  } catch (err) {
    cancelTickFocus();
    throw err;
  }
}

// A tick entered by value and position: the first free end, else the middle.
// On a known colormap it is just a position; otherwise it goes on the bar.
export function typeTick(w: WorkspaceContext) {
  const cb = w.activePanel().colorbar;
  if (!cb.colormap && !(cb.start && cb.end)) return;
  const used = ticksWithT(cb).map((k) => k.t);
  const t = [0, 1, 0.5].find((x) => !used.some((u) => Math.abs(u - x) < 1e-6)) ?? 0.5;
  const id = w.newTickId();
  const tick: Tick = cb.colormap ? { id, t, value: NaN } : { id, ...pointAtT(cb.start!, cb.end!, t), value: NaN };
  requestTickFocus(id);
  try {
    w.commit((p) => p.colorbar.ticks.push(tick));
  } catch (err) {
    cancelTickFocus();
    throw err;
  }
}

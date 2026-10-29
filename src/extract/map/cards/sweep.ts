// Map tool, profile sweep: moves the edited profile along its normal, one animation frame at a time. Imperative:
// a frame redraws the plot and the "line at" text through refs (mctx.ui) and does not notify React, which would
// re-render the cards 60 times a second; the card is told only when what it shows besides the plot changes.

import type { Panel, PixelImage, Point, Profile } from '../../../types/index.ts';
import { profileDivisor, sampleProfile, sweepRange } from '../field.ts';
import type { MapSweep, MapToolContext } from '../map-tool.ts';
import { profileView, sweepAtText } from './profile-view.ts';

export function createSweep(mctx: MapToolContext) {
  const { ws, state } = mctx;
  const { app } = ws;

  // state.sweep moves the edited profile along its normal, back and forth
  // between the edges of the plot area, one animation frame at a time. The
  // profile really moves; the undo step pushed at the start puts it back.

  const sweepSpeed = () => {
    const v = state.sweepSpeed;
    return Number.isFinite(v) && v > 0 ? Math.min(500, v) : 20;
  };
  const shifted = (p: Point, n: Point, s: number) => ({ x: p.x + s * n.x, y: p.y + s * n.y });

  function startSweep() {
    const panel = ws.activePanel();
    const l = mctx.selectedProfile();
    const image = app.pages.get(panel.page)?.imageData;
    if (!l || !image || app.mode) return;
    const range = sweepRange(panel.grid.corners, l.a, l.b, { runOff: state.sweepRunOff });
    if ('error' in range) return ws.toast(range.error, true);
    if (range.max - range.min < 1) return ws.toast('The profile has no room to move inside the plot area.', true);
    ws.pushHistory();
    const sweep: MapSweep = {
      panelId: panel.id,
      id: l.id,
      a0: l.a,
      b0: l.b,
      ...range,
      s: 0,
      dir: range.max >= 1 ? 1 : -1,
      last: null,
      yRange: sweepValueRange(image, panel, l, range),
      set: { a: l.a, b: l.b },
      frame: 0,
    };
    state.sweep = sweep;
    sweep.frame = requestAnimationFrame(sweepFrame);
    ws.changed({ light: true });
  }

  // The plotted values (after Scale) over 25 positions across the sweep.
  function sweepValueRange(
    image: ImageData | PixelImage,
    panel: Panel,
    l: Profile,
    { n, min, max }: { n: Point; min: number; max: number },
  ): [number, number] | null {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k <= 24; k++) {
      const s = min + ((max - min) * k) / 24;
      const samples = sampleProfile(image, panel, { ...l, a: shifted(l.a, n, s), b: shifted(l.b, n, s) });
      if (!Array.isArray(samples) || !samples.length) continue;
      const { divisor } = profileDivisor(samples, state.profileNorm) as { divisor?: number };
      if (!divisor) continue;
      for (const q of samples) {
        if (q.outside) continue;
        const v = q.value / divisor;
        if (!Number.isFinite(v)) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    return lo <= hi ? [lo, hi] : null;
  }

  function sweepFrame(now: number) {
    const sw = state.sweep;
    if (!sw) return;
    const panel = ws.activePanel();
    const l = panel.map.profiles.find((x) => x.id === sw.id);
    // Anything else that moved the line (a drag, a typed length, undo),
    // or leaving it, ends the sweep.
    if (
      ws.tool().kind !== 'map' ||
      panel.id !== sw.panelId ||
      !l ||
      state.selectedId !== sw.id ||
      l.a !== sw.set.a ||
      l.b !== sw.set.b
    )
      return stopSweep();
    // A long gap (a hidden tab) does not make the line jump.
    const dt = sw.last === null ? 0 : Math.min(0.1, (now - sw.last) / 1000);
    sw.last = now;
    let s = sw.s + sw.dir * sweepSpeed() * dt;
    // Bounce off the edges, keeping the overshoot.
    if (s > sw.max) {
      s = 2 * sw.max - s;
      sw.dir = -1;
    } else if (s < sw.min) {
      s = 2 * sw.min - s;
      sw.dir = 1;
    }
    sw.s = Math.min(sw.max, Math.max(sw.min, s));
    l.a = shifted(sw.a0, sw.n, sw.s);
    l.b = shifted(sw.b0, sw.n, sw.s);
    sw.set = { a: l.a, b: l.b };
    refresh(panel, l);
    sw.frame = requestAnimationFrame(sweepFrame);
  }

  function stopSweep() {
    if (!state.sweep) return;
    cancelAnimationFrame(state.sweep.frame);
    state.sweep = null;
    // A full change: the card's button reads state.sweep, also when another tool is shown.
    ws.changed();
  }

  function toggleSweep() {
    if (state.sweep) stopSweep();
    else startSweep();
  }

  // One frame: the viewer and the plot follow the moved line. The card (its problem text, CSV button) is
  // re-rendered only when those would change, e.g. the line runs off the plot.
  function refresh(panel: Panel, sel: Profile) {
    ws.viewer.requestDraw();
    const view = profileView(mctx, panel, mctx.selectedProfiles());
    if (view.signature !== mctx.ui.viewSignature) return ws.changed({ light: true });
    mctx.plot.drawProfiles(panel, view.series);
    if (mctx.ui.sweepAt) mctx.ui.sweepAt.textContent = sweepAtText(panel, sel);
  }

  // Switching edges mid-sweep: the new range around where it started.
  function retarget() {
    const sw = state.sweep;
    if (!sw) return;
    const panel = ws.activePanel();
    const range = sweepRange(panel.grid.corners, sw.a0, sw.b0, { runOff: state.sweepRunOff });
    if ('error' in range) return;
    Object.assign(sw, { min: range.min, max: range.max, s: Math.min(range.max, Math.max(range.min, sw.s)) });
    const l = mctx.selectedProfile();
    const image = app.pages.get(panel.page)?.imageData;
    if (l && image) sw.yRange = sweepValueRange(image, panel, { ...l, a: sw.a0, b: sw.b0 }, sw);
  }

  return { stopSweep, toggleSweep, sweepValueRange, retarget };
}

export type Sweep = ReturnType<typeof createSweep>;

// Map tool, profile sweep: moves the edited profile along its normal and shows where the line is.

import { invertBilinear } from '../../../core/grid.ts';
import type { Panel, PixelImage, Point, Profile } from '../../../types/index.ts';
import { formatNumber } from '../../project/project-files.ts';
import { mapCoord, profileDivisor, sampleProfile, sweepRange } from '../field.ts';
import type { MapSweep, MapToolContext } from '../map-tool.ts';

export function setupSweep(mctx: MapToolContext) {
  const { ws, state } = mctx;
  const { $, app } = ws;

  // state.sweep moves the edited profile along its normal, back and forth
  // between the edges of the plot area, one animation frame at a time. The
  // profile really moves; the undo step pushed at the start puts it back.

  const sweepSpeed = () => {
    const v = Number($('profile-sweep-speed').value);
    return Number.isFinite(v) && v > 0 ? Math.min(500, v) : 20;
  };
  const shifted = (p: Point, n: Point, s: number) => ({ x: p.x + s * n.x, y: p.y + s * n.y });

  function startSweep() {
    const panel = ws.activePanel();
    const l = mctx.selectedProfile();
    const image = app.pages.get(panel.page)?.imageData;
    if (!l || !image || app.mode) return;
    const range = sweepRange(panel.grid.corners, l.a, l.b, { runOff: $('profile-sweep-runoff').checked });
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
    ws.changed({ light: true });
    sw.frame = requestAnimationFrame(sweepFrame);
  }

  function stopSweep() {
    if (!state.sweep) return;
    cancelAnimationFrame(state.sweep.frame);
    state.sweep = null;
    // Also when another tool's sidebar is shown, so the button is right on return.
    ws.setPressed($('profile-sweep'), false);
    $('profile-sweep').textContent = 'Sweep';
    $('profile-sweep').dataset.icon = 'play';
    ws.changed();
  }

  function toggleSweep() {
    if (state.sweep) stopSweep();
    else startSweep();
  }

  // The Sweep button, and where the line is across the plot: its midpoint
  // on the axis it moves along.
  function renderSweep(panel: Panel, sel: Profile) {
    const btn = $('profile-sweep');
    const on = !!state.sweep;
    ws.setPressed(btn, on);
    // Runs every frame while sweeping: touch the label only when it changes,
    // so a press on the button is never cut short by a replaced text node.
    const label = on ? 'Pause' : 'Sweep';
    if (btn.textContent !== label) btn.textContent = label;
    btn.dataset.icon = on ? 'pause' : 'play';
    btn.disabled = !on && !panel.grid.corners;
    const at = $('profile-sweep-at');
    if (!panel.grid.corners) {
      at.textContent = '';
      return;
    }
    const across = Math.abs(sel.b.x - sel.a.x) >= Math.abs(sel.b.y - sel.a.y) ? 'y' : 'x';
    const { u, v } = invertBilinear(panel.grid.corners, { x: (sel.a.x + sel.b.x) / 2, y: (sel.a.y + sel.b.y) / 2 });
    // In the units of the Coordinates setting, as in the CSVs and status bar.
    const c = mapCoord(panel, across);
    const value = c.at!(across === 'x' ? u : v);
    const unit = c.kind === 'px' ? ' px' : c.kind === 'length' ? ` ${panel.scale!.unit}` : '';
    at.textContent = `Line at ${across} = ${c.kind === 'px' ? value.toFixed(1) : formatNumber(value)}${unit}`;
  }

  function bind() {
    $('profile-sweep').addEventListener('click', toggleSweep);
    // Switching edges mid-sweep: the new range around where it started.
    $('profile-sweep-runoff').addEventListener('change', (e) => {
      const sw = state.sweep;
      if (!sw) return;
      const panel = ws.activePanel();
      const range = sweepRange(panel.grid.corners, sw.a0, sw.b0, { runOff: (e.target as HTMLInputElement).checked });
      if ('error' in range) return;
      Object.assign(sw, { min: range.min, max: range.max, s: Math.min(range.max, Math.max(range.min, sw.s)) });
      const l = mctx.selectedProfile();
      const image = app.pages.get(panel.page)?.imageData;
      if (l && image) sw.yRange = sweepValueRange(image, panel, { ...l, a: sw.a0, b: sw.b0 }, sw);
    });
  }

  return { renderSweep, stopSweep, toggleSweep, sweepValueRange, bind };
}

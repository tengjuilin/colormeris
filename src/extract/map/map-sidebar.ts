import { invertBilinear } from '../../core/grid.ts';
import type {
  AxisScale,
  AxisTick,
  DomEl,
  ErrorResult,
  MapField,
  MapResult,
  MapUnits,
  Panel,
  PixelImage,
  Point,
  Profile,
  ProfileSample,
} from '../../types/index.ts';
import {
  formatNumber,
  mapLongCsv,
  mapMatrixCsv,
  profileCsv,
  profilesCsv,
  safeFileName,
} from '../project/project-files.ts';
import {
  type AxisKey,
  axisEdgePoint,
  axisFn,
  axisT,
  coordKind,
  lengthPerPixel,
  mapCoord,
  mapSize,
  profileAxisKey,
  profileDivisor,
  profileEndForLength,
  profileLength,
  profileXKind,
  sampleProfile,
  sweepRange,
} from './field.ts';
import type { MapSweep, MapToolContext } from './map-tool.ts';

/** A profile to plot: its samples, the divisor of the normalization and its color. */
interface Series {
  profile: Profile;
  samples: ProfileSample[];
  divisor: number;
  color: string;
}

/** A series with its x and y values as plotted. */
interface PlotLine extends Series {
  xs: number[];
  ys: number[];
}

/** What the profile plot shows, kept for mapping the pointer to a sample. */
interface PlotState {
  panel: Panel;
  series: Series[];
  lines: PlotLine[];
  sx: (x: number) => number;
  sy: (y: number) => number;
}

// Map tool, DOM: the sidebar cards (Axes, Profiles, Results), the profile
// plot and the CSV downloads. Set up by map-tool.ts.
//
// mctx: { ws, state, selectedProfile, selectedProfiles, isSelected,
// selectProfile, profileColor, toggleMode, deleteSelected, AXIS_COLORS } (see
// map-tool.ts; toggleMode and deleteSelected are added after this setup and
// looked up at call time).

export function setupMapSidebar(mctx: MapToolContext) {
  const { ws, state } = mctx;
  const { $, app, viewer } = ws;

  function renderSidebar(panel: Panel) {
    renderScale(panel);
    renderAxes(panel);
    renderProfiles(panel);
    renderResults(panel);
  }

  // ---------------------------------------------------------------- scale bar
  // The card's buttons and fields are bound in roi/roi-sidebar.ts.

  function renderScale(panel: Panel) {
    const sc = panel.scale;
    $('scale-clear').disabled = !sc;
    if (sc) {
      ws.setValue($('scale-length'), sc.length);
      ws.setValue($('scale-unit'), sc.unit);
      const px = Math.hypot(sc.p2.x - sc.p1.x, sc.p2.y - sc.p1.y);
      $('scale-info').textContent = `${px.toFixed(1)} px = ${sc.length} ${sc.unit}`;
    } else {
      $('scale-info').textContent = '';
    }
    ws.setBadge($('scale-state'), sc ? `${sc.length} ${sc.unit}` : 'pixels', !!sc);
  }

  // ---------------------------------------------------------------- axes

  const tickKeys = { x: '', y: '' };
  function renderAxes(panel: Panel) {
    const states: string[] = [];
    for (const key of ['x', 'y'] as const) {
      const axis = panel.map[key];
      ws.setValue($(`axis-${key}-scale`), axis.scale);
      $(`axis-${key}-add`).disabled = !panel.grid.corners;
      renderAxisTicks(panel, key);
      const { fn, problem } = axisFn(panel, key);
      $(`axis-${key}-problem`).textContent = problem || '';
      if (fn) states.push(key);
    }
    ws.setBadge($('axes-state'), states.length ? `${states.join(', ')} calibrated` : 'pixels', states.length === 2);
  }

  function renderAxisTicks(panel: Panel, key: AxisKey) {
    const ticks = panel.map[key].ticks;
    const tbody = $(`axis-${key}-ticks`);
    tbody.closest('table')!.hidden = ticks.length === 0;
    const ids = `${panel.id}|${ticks.map((k) => k.id).join(',')}`;
    if (ids !== tickKeys[key]) {
      tickKeys[key] = ids;
      tbody.replaceChildren(...ticks.map((k) => tickRow(key, k)));
    }
    for (const k of ticks) {
      const tr = tbody.querySelector(`tr[data-id="${k.id}"]`);
      if (!tr) continue;
      ws.setValue(tr.querySelector('input') as DomEl, Number.isFinite(k.value) ? k.value : '');
      tr.classList.toggle('invalid', !Number.isFinite(k.value));
      const t = panel.grid.corners ? axisT(panel, key, k) : NaN;
      ws.setValue(tr.querySelector('.pos input') as DomEl, Number.isFinite(t) ? Math.round(t * 1000) / 10 : '');
    }
  }

  function tickRow(key: AxisKey, k: AxisTick) {
    const tr = document.createElement('tr');
    tr.dataset.id = k.id;
    const input = Object.assign(document.createElement('input'), { type: 'number', step: 'any', placeholder: 'value' });
    input.setAttribute('aria-label', `${key.toUpperCase()} axis tick value`);
    input.addEventListener('focus', () => ws.pushHistory());
    input.addEventListener('input', () => {
      const tick = ws.activePanel().map[key].ticks.find((x) => x.id === k.id);
      if (tick) tick.value = input.value === '' ? NaN : Number(input.value);
      ws.changed({ light: true });
    });
    input.addEventListener('change', () => ws.changed());
    // Escape after typing a value ends tick mode too; otherwise the next
    // click on the image (meant to leave the mode) adds another tick.
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') {
        e.stopPropagation();
        input.blur();
        ws.setMode(null);
      }
    });
    // Position as % across the plot area, editable as on the colorbar, for
    // ticks whose mark is hard to click (e.g. on the plot's own edge).
    const pos = Object.assign(document.createElement('td'), { className: 'pos' });
    const at = Object.assign(document.createElement('input'), {
      type: 'number',
      step: 'any',
      min: '-50',
      max: '150',
      className: 'num',
      title: `Position across the plot area: 0% at the ${key === 'x' ? 'left' : 'top'}, 100% at the ${key === 'x' ? 'right' : 'bottom'}`,
    });
    at.setAttribute('aria-label', `Position in % across the plot area (${key} axis)`);
    at.addEventListener('focus', () => ws.pushHistory());
    at.addEventListener('change', () => {
      const panel = ws.activePanel();
      const tick = panel.map[key].ticks.find((x) => x.id === k.id);
      const v = Number(at.value);
      if (!tick || !panel.grid.corners || at.value === '' || !Number.isFinite(v)) return ws.changed();
      Object.assign(tick, axisEdgePoint(panel, key, v / 100));
      ws.changed();
    });
    at.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') at.blur();
    });
    pos.append(at, '%');
    const del = Object.assign(document.createElement('button'), {
      className: 'btn subtle icon',
      textContent: '×',
      title: 'Remove tick',
    });
    del.setAttribute('aria-label', 'Remove tick');
    del.addEventListener('click', () =>
      ws.commit((p) => (p.map[key].ticks = p.map[key].ticks.filter((x) => x.id !== k.id))),
    );
    const tdIn = document.createElement('td');
    tdIn.append(input);
    const tdDel = document.createElement('td');
    tdDel.append(del);
    tr.append(tdIn, pos, tdDel);
    return tr;
  }

  function focusAxisTick(key: AxisKey, id: string) {
    requestAnimationFrame(() =>
      $(`axis-${key}-ticks`).querySelector<HTMLInputElement>(`tr[data-id="${id}"] input`)?.focus(),
    );
  }

  // ---------------------------------------------------------------- profiles
  // state.selectedId is the profile edited in the card; state.overlay holds
  // more selected profiles. The plot overlays all of them, each in its color.

  let profileListKey = '';
  function renderProfiles(panel: Panel) {
    const profiles = panel.map.profiles;
    const ids = new Set(profiles.map((l) => l.id));
    if (state.selectedId && !ids.has(state.selectedId)) state.selectedId = null;
    for (const id of state.overlay) if (!ids.has(id) || id === state.selectedId) state.overlay.delete(id);
    if (!state.selectedId && state.overlay.size) {
      state.selectedId = [...state.overlay].pop()!;
      state.overlay.delete(state.selectedId);
    }
    // A single profile is the one shown, without clicking it first.
    if (!state.selectedId && profiles.length === 1) state.selectedId = profiles[0].id;
    const shown = mctx.selectedProfiles();
    const key = JSON.stringify([panel.id, state.selectedId, [...state.overlay], profiles.map((l) => [l.id, l.name])]);
    if (key !== profileListKey) {
      profileListKey = key;
      $('profile-list').replaceChildren(
        ...profiles.map((l) => {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.className = 'chip';
          btn.setAttribute('aria-pressed', String(mctx.isSelected(l.id)));
          btn.title = 'Shift- or Cmd-click to overlay several profiles in the plot';
          const sw = document.createElement('span');
          sw.className = 'swatch';
          sw.style.background = mctx.profileColor(panel, l);
          btn.append(
            sw,
            Object.assign(document.createElement('span'), { className: 'chip-label', textContent: l.name }),
          );
          btn.addEventListener('click', (e) => mctx.selectProfile(l.id, { add: e.shiftKey || e.metaKey || e.ctrlKey }));
          li.append(btn);
          return li;
        }),
      );
    }
    const n = profiles.length;
    ws.setBadge($('profile-state'), n ? `${n} profile${n === 1 ? '' : 's'}` : 'none', n > 0);
    $('profile-all').hidden = n < 2 || shown.length === n;
    const sel = mctx.selectedProfile();
    $('profile-edit').hidden = !sel;
    $('profile-delete').hidden = !sel;
    $('profile-view').hidden = !sel;
    if (!sel) return;
    ws.setValue($('profile-name'), sel.name);
    ws.setValue($('profile-width'), sel.halfWidth);
    const { length, kind } = profileLength(panel, sel);
    const unit = kind === 'length' ? panel.scale!.unit : kind;
    ws.setValue($('profile-length'), Number(length.toPrecision(6)));
    $('profile-length-label').textContent = `Length (${unit})`;
    $('profile-length-field').title =
      (kind === 'x' || kind === 'y'
        ? `Span of ${kind} values along the profile.`
        : `Length of the profile in ${kind === 'px' ? 'pixels' : unit}.`) +
      ' Typing a length moves its end; the start and direction stay.';
    $('profile-delete').title =
      shown.length > 1
        ? `Delete the ${shown.length} selected profiles (Delete or Backspace; ⌫ on a Mac)`
        : 'Delete (Delete or Backspace; ⌫ on a Mac)';
    const results = (ws.resultFor(panel) as MapResult).profiles || {};
    const series: Series[] = [];
    const errors: { name: string; error: string }[] = [];
    ws.setValue($('profile-norm'), state.profileNorm);
    // Show what is plotted, which may be a fallback from the choice.
    renderUnits(
      $('profile-x'),
      panel,
      shown.some((l) => profileAxisKey(panel, l)),
      kind === 'x' || kind === 'y' ? 'axis' : kind,
    );
    for (const l of shown) {
      const samples = results[l.id] as ProfileSample[] & ErrorResult;
      const norm = Array.isArray(samples) ? profileDivisor(samples, state.profileNorm) : null;
      // A sweep running off the edge plots nothing for a moment; that is no error.
      const gone = Array.isArray(samples) && samples.every((q) => q.outside) && !state.sweep;
      const error =
        samples?.error ||
        (!samples
          ? 'Calibrate the colorbar to read the profile.'
          : gone
            ? 'The profile lies outside the plot area.'
            : norm!.error);
      if (error) errors.push({ name: l.name, error });
      else
        series.push({
          profile: l,
          samples,
          divisor: (norm as { divisor: number }).divisor,
          color: mctx.profileColor(panel, l),
        });
    }
    // The same problem for every profile (no colorbar yet) is said once.
    const once = errors.length === shown.length && new Set(errors.map((e) => e.error)).size === 1;
    $('profile-problem').textContent = once ? errors[0].error : errors.map((e) => `${e.name}: ${e.error}`).join(' ');
    $('profile-csv').disabled = !series.length;
    renderSweep(panel, sel);
    $('profile-csv').textContent =
      series.length > 1 ? `Download ${series.length} profiles CSV` : 'Download profile CSV';
    drawProfiles(panel, series);
  }

  // ---------------------------------------------------------------- tracing
  // state.trace = {id, i}: sample i of profile id, under the pointer on the
  // image (map-tool.ts) or on the plot. Both draw it, so the two stay in step.

  let plot: PlotState | null = null; // what the plot shows, for mapping the pointer to a sample

  function setTrace(trace: { id: string; i: number } | null) {
    const same = trace && state.trace && trace.id === state.trace.id && trace.i === state.trace.i;
    if (same || (!trace && !state.trace)) return;
    state.trace = trace;
    redrawProfile();
    viewer.requestDraw();
  }

  function redrawProfile() {
    if (plot) drawProfiles(plot.panel, plot.series);
  }

  // Plot against what the X axis select asks for (see profileXKind):
  // the calibrated axis the lines mostly run along, the distance along the
  // lines in scale-bar units, or in pixels. Overlaid profiles share it, so
  // lines along different axes fall back to a distance.
  function plotAxis(
    panel: Panel,
    series: Series[],
  ): { get: (s: ProfileSample) => number; name: string; short: string } {
    const kinds = new Set(series.map((s) => profileXKind(panel, s.profile)));
    const kind =
      kinds.size === 1 ? [...kinds][0] : kinds.has('length') || lengthPerPixel(panel.scale) !== null ? 'length' : 'px';
    if (kind === 'x' || kind === 'y') return { get: (s) => s[kind] as number, name: kind, short: kind };
    if (kind === 'length') return { get: (s) => s.len as number, name: `distance (${panel.scale!.unit})`, short: 'd' };
    return { get: (s) => s.d, name: 'distance (px)', short: 'd' };
  }

  // series: [{profile, samples, divisor, color}]; values are plotted
  // divided by divisor (1 unless normalized).
  function drawProfiles(panel: Panel, series: Series[]) {
    const canvas = $('profile-plot') as unknown as HTMLCanvasElement;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 300;
    const cssH = canvas.clientHeight || 140;
    // Assigning width reallocates the bitmap even when unchanged; the plot
    // is redrawn on every sweep frame and trace move.
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    plot = null;
    series = series.filter((s) => s.samples.length);
    if (!series.length) return;
    const css = getComputedStyle(canvas);
    const text = css.getPropertyValue('--text').trim() || '#222';
    const muted = css.getPropertyValue('--muted').trim() || '#777';
    const border = css.getPropertyValue('--border').trim() || '#ddd';
    const accent = css.getPropertyValue('--accent').trim() || '#3b47e0';
    const danger = css.getPropertyValue('--danger').trim() || '#c62a2a';
    const axis = plotAxis(panel, series);
    // A single profile keeps the accent color; overlaid ones match their lines.
    const lines: PlotLine[] = series.map((s) => ({
      ...s,
      xs: s.samples.map(axis.get),
      ys: s.samples.map((q) => q.value / s.divisor),
      color: series.length > 1 ? s.color : accent,
    }));
    // The x span covers whole lines; values only the parts inside the plot area.
    const allX = lines.flatMap((s) => s.xs);
    const allY = lines.flatMap((s) => s.ys.filter((y, i) => !s.samples[i].outside));
    const [x0, x1] = [Math.min(...allX), Math.max(...allX)];
    let [y0, y1] = allY.length ? [Math.min(...allY), Math.max(...allY)] : [Infinity, -Infinity];
    // While sweeping, the value axis holds still (widened if a frame
    // goes past it), so heights compare between frames.
    const fixed = state.sweep?.yRange;
    if (fixed) {
      fixed[0] = Math.min(fixed[0], y0);
      fixed[1] = Math.max(fixed[1], y1);
      [y0, y1] = fixed;
    }
    if (!Number.isFinite(y0)) return;
    if (y1 - y0 < 1e-12) [y0, y1] = [y0 - 0.5, y1 + 0.5];
    const pad = { l: 44, r: 8, t: 8, b: 30 };
    const W = cssW - pad.l - pad.r;
    const H = cssH - pad.t - pad.b;
    const sx = (x: number) => pad.l + ((x - x0) / (x1 - x0 || 1)) * W;
    const sy = (y: number) => pad.t + (1 - (y - y0) / (y1 - y0)) * H;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, W, H);
    for (const s of lines) {
      ctx.beginPath();
      // A gap where the line is outside the plot area.
      s.ys.forEach((y, i) => {
        if (s.samples[i].outside) return;
        if (i && !s.samples[i - 1].outside) ctx.lineTo(sx(s.xs[i]), sy(y));
        else ctx.moveTo(sx(s.xs[i]), sy(y));
      });
      ctx.strokeStyle = s.color;
      ctx.lineWidth = series.length > 1 ? 2 : 1.5;
      ctx.stroke();
    }
    // Flagged or possibly clipped samples as red dots on the lines.
    ctx.fillStyle = danger;
    for (const s of lines) {
      s.samples.forEach((q, i) => {
        if (!q.outside && (q.flagged || q.clipped)) ctx.fillRect(sx(s.xs[i]) - 1.5, sy(s.ys[i]) - 1.5, 3, 3);
      });
    }
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = muted;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText(shortLabel(y1), pad.l - 4, pad.t + 4);
    ctx.fillText(shortLabel(y0), pad.l - 4, pad.t + H - 4);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    // With one profile its start is on the left even when x decreases along it.
    const [xl, xr] = lines.length === 1 ? [lines[0].xs[0], lines[0].xs.at(-1)!] : [x0, x1];
    ctx.fillText(shortLabel(xl), pad.l, pad.t + H + 4);
    ctx.textAlign = 'right';
    ctx.fillText(shortLabel(xr), pad.l + W, pad.t + H + 4);
    ctx.textAlign = 'center';
    ctx.fillStyle = text;
    const scaled = { max: ' · values ÷ each max', mean: ' · values ÷ each mean' }[state.profileNorm] || '';
    ctx.fillText(axis.name + scaled, pad.l + W / 2, pad.t + H + 4);
    plot = { panel, series, lines, sx, sy };
    const traced = state.trace && lines.find((s) => s.profile.id === state.trace!.id);
    const tracedSample = traced?.samples[state.trace!.i];
    if (tracedSample && !tracedSample.outside) {
      drawTraceMark(ctx, {
        i: state.trace!.i,
        line: traced!,
        sx,
        sy,
        pad,
        W,
        H,
        axis,
        text,
        css,
        many: lines.length > 1,
      });
    }
  }

  // Guide line, dot and readout for the traced sample.
  function drawTraceMark(
    ctx: CanvasRenderingContext2D,
    {
      i,
      line,
      sx,
      sy,
      pad,
      W,
      H,
      axis,
      text,
      css,
      many,
    }: {
      i: number;
      line: PlotLine;
      sx: (x: number) => number;
      sy: (y: number) => number;
      pad: { l: number; r: number; t: number; b: number };
      W: number;
      H: number;
      axis: { short: string };
      text: string;
      css: CSSStyleDeclaration;
      many: boolean;
    },
  ) {
    const s = line.samples[i];
    const x = sx(line.xs[i]);
    const y = sy(line.ys[i]);
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = text;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, pad.t);
    ctx.lineTo(Math.round(x) + 0.5, pad.t + H);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, 2 * Math.PI);
    ctx.fillStyle = line.color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = css.getPropertyValue('--surface').trim() || '#fff';
    ctx.stroke();
    const name = many ? `${line.profile.name} · ` : '';
    // Normalized values are followed by the value they come from.
    const value = line.divisor === 1 ? shortLabel(s.value) : `${shortLabel(line.ys[i])} (${shortLabel(s.value)})`;
    const label = `${name}${axis.short} ${shortLabel(line.xs[i])}: ${value}`;
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    // Readout on the side of the guide with more room.
    const right = x < pad.l + W / 2;
    ctx.textAlign = right ? 'left' : 'right';
    ctx.fillStyle = text;
    ctx.fillText(label, x + (right ? 6 : -6), pad.t + 3);
  }

  // Pointer on the plot → for each line the nearest sample along the
  // horizontal axis; of those, the one closest to the pointer vertically.
  $('profile-plot').addEventListener('pointermove', (e) => {
    if (!plot) return;
    const r = $('profile-plot').getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    let best: { score: number; trace: { id: string; i: number } } | null = null;
    for (const s of plot.lines) {
      let i = -1;
      for (let k = 0; k < s.xs.length; k++) {
        if (!s.samples[k].outside && (i < 0 || Math.abs(plot.sx(s.xs[k]) - mx) < Math.abs(plot.sx(s.xs[i]) - mx)))
          i = k;
      }
      if (i < 0) continue;
      const dx = Math.abs(plot.sx(s.xs[i]) - mx);
      const dy = Math.abs(plot.sy(s.ys[i]) - my);
      // Lines that do not reach the pointer lose to those that do.
      const score = dy + (dx > 4 ? 1e6 + dx : 0);
      if (!best || score < best.score) best = { score, trace: { id: s.profile.id, i } };
    }
    setTrace(best ? best.trace : null);
  });
  $('profile-plot').addEventListener('pointerleave', () => setTrace(null));

  const shortLabel = (v: number) => {
    if (!Number.isFinite(v)) return '';
    const a = Math.abs(v);
    return a !== 0 && (a >= 1e5 || a < 1e-2) ? v.toExponential(2) : String(Number(v.toPrecision(4)));
  };

  // ---------------------------------------------------------------- sweep
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

  // ---------------------------------------------------------------- results

  function renderResults(panel: Panel) {
    ws.setValue($('map-bin'), panel.map.bin);
    const axisFns = (['x', 'y'] as const).map((k) => !!(panel.grid.corners && axisFn(panel, k).fn));
    // With one axis calibrated, 'axis' reports the other in length or pixels.
    renderUnits(
      $('map-units'),
      panel,
      axisFns.some(Boolean),
      axisFns.some(Boolean) && panel.map.units === 'axis' ? 'axis' : coordKind(panel, 'x'),
    );
    const res = ws.resultFor(panel) as MapField & { axisProblems?: string[] };
    $('map-dl-csv').disabled = $('map-dl-long').disabled = !!res.error;
    $('map-axis-hint').textContent = res.axisProblems?.join(' ') || '';
    if (res.error) {
      $('map-problem').textContent = res.error;
      $('map-summary').textContent = panel.grid.corners ? sizeText(panel) : '';
      return;
    }
    $('map-problem').textContent = '';
    const s = res.stats;
    const clipped = s.clippedLow + s.clippedHigh;
    const total = res.values.length;
    const pct = (n: number) => (n / total < 0.001 && n ? '<0.1' : ((100 * n) / total).toFixed(1));
    $('map-summary').textContent = [
      `${res.cols} × ${res.rows} values${res.bin > 1 ? ` (bins of ${res.bin} px)` : ' (native pixels)'}`,
      `range ${formatNumber(s.min)} – ${formatNumber(s.max)}`,
      `colorbar resolves about ${s.levels} levels`,
      s.flagged ? `${s.flagged} flagged (${pct(s.flagged)}%, ΔE > ${panel.settings.maxDeltaE})` : 'no flagged values',
      clipped ? `${clipped} at a colorbar end (${pct(clipped)}%, may be clipped)` : 'none at a colorbar end',
    ].join(' · ');
  }

  // A units select (profile-x or map-units): options that are not
  // available are disabled, the length option is named by its unit, and it
  // shows `value`, what is reported.
  function renderUnits(select: DomEl, panel: Panel, hasAxis: boolean, value: string) {
    const [axisOpt, , lengthOpt] = select.options;
    axisOpt.disabled = !hasAxis;
    lengthOpt.disabled = lengthPerPixel(panel.scale) === null;
    lengthOpt.textContent = panel.scale?.unit ?? 'Scale bar';
    ws.setValue(select, value);
  }

  function sizeText(panel: Panel) {
    const { rows, cols } = mapSize(panel);
    return `${cols} × ${rows} values at this bin size.`;
  }

  // ---------------------------------------------------------------- bindings

  for (const key of ['x', 'y'] as const) {
    $(`axis-${key}-add`).addEventListener('click', () => mctx.toggleMode(`${key}tick`));
    $(`axis-${key}-scale`).addEventListener('change', (e) =>
      ws.commit((p) => (p.map[key].scale = (e.target as HTMLSelectElement).value as AxisScale)),
    );
  }
  $('profile-add').addEventListener('click', () => mctx.toggleMode('profile'));
  ws.bindText('profile-name', (p, v) => {
    const l = p.map.profiles.find((x) => x.id === state.selectedId);
    if (l) l.name = v;
  });
  ws.bindNumber('profile-width', (p, v) => {
    const l = p.map.profiles.find((x) => x.id === state.selectedId);
    if (l) l.halfWidth = Math.min(50, Math.max(0, Math.round(v)));
  });
  ws.bindNumber('profile-length', (p, v) => {
    const l = p.map.profiles.find((x) => x.id === state.selectedId);
    const b = l && profileEndForLength(p, l, v);
    if (b) l.b = b;
  });
  $('profile-all').addEventListener('click', () => {
    const profiles = ws.activePanel().map.profiles;
    state.selectedId ??= profiles[0]?.id ?? null;
    for (const l of profiles) if (l.id !== state.selectedId) state.overlay.add(l.id);
    ws.changed();
  });
  $('profile-delete').addEventListener('click', () => mctx.deleteSelected());
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
  // One setting for the profile plot and the matrix, edited from either card.
  for (const id of ['profile-x', 'map-units'])
    $(id).addEventListener('change', (e) =>
      ws.commit((p) => (p.map.units = (e.target as HTMLSelectElement).value as MapUnits)),
    );
  $('profile-norm').addEventListener('change', (e) => {
    state.profileNorm = (e.target as HTMLSelectElement).value;
    // The fixed value axis was measured in the old scale.
    if (state.sweep) {
      const panel = ws.activePanel();
      const l = mctx.selectedProfile();
      const image = app.pages.get(panel.page)?.imageData;
      state.sweep.yRange =
        l && image ? sweepValueRange(image, panel, { ...l, a: state.sweep.a0, b: state.sweep.b0 }, state.sweep) : null;
    }
    ws.changed({ light: true });
  });
  $('profile-csv').addEventListener('click', () => {
    const panel = ws.activePanel();
    const results = (ws.resultFor(panel) as MapResult).profiles || {};
    const mode = state.profileNorm;
    // The normalized column follows the plot; a profile that cannot be
    // normalized leaves it empty.
    const normOf = (samples: ProfileSample[]) =>
      mode === 'raw' ? null : { mode, divisor: (profileDivisor(samples, mode) as { divisor?: number }).divisor ?? NaN };
    const entries = mctx
      .selectedProfiles()
      .filter((l) => Array.isArray(results[l.id]))
      .map((l) => ({
        name: l.name,
        samples: results[l.id] as ProfileSample[],
        norm: normOf(results[l.id] as ProfileSample[]),
      }));
    if (!entries.length) return;
    const unit = lengthPerPixel(panel.scale) !== null ? panel.scale!.unit : null;
    const [csv, suffix] =
      entries.length === 1
        ? [profileCsv(entries[0].samples, entries[0].norm, unit), `_profile_${safeFileName(entries[0].name)}`]
        : [profilesCsv(entries, unit), '_profiles'];
    ws.download(new Blob([csv], { type: 'text/csv' }), ws.csvName(panel, suffix));
  });
  ws.bindNumber('map-bin', (p, v) => (p.map.bin = Math.min(256, Math.max(1, Math.round(v)))));
  $('map-recon').addEventListener('change', (e) => {
    state.showRecon = (e.target as HTMLInputElement).checked;
    viewer.requestDraw();
  });
  $('map-flags').addEventListener('change', (e) => {
    state.showFlags = (e.target as HTMLInputElement).checked;
    viewer.requestDraw();
  });
  $('map-dl-csv').addEventListener('click', () => {
    const p = ws.activePanel();
    const r = ws.resultFor(p) as MapResult;
    if (!r.error) ws.download(new Blob([mapMatrixCsv(p, r as MapField)], { type: 'text/csv' }), ws.csvName(p, '_map'));
  });
  $('map-dl-long').addEventListener('click', () => {
    const p = ws.activePanel();
    const r = ws.resultFor(p) as MapResult;
    if (!r.error)
      ws.download(new Blob([mapLongCsv([{ panel: p, result: r }])], { type: 'text/csv' }), ws.csvName(p, '_map_long'));
  });
  // The plot follows the card's width.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => app.sourceCanvas && ws.tool().kind === 'map' && renderProfiles(ws.activePanel())).observe(
      $('profile-plot'),
    );
  }

  return { renderSidebar, focusAxisTick, setTrace, stopSweep, toggleSweep };
}

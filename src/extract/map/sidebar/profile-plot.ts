// Map tool, profile plot: draws the profiles on a canvas and traces the sample under the pointer.

import type { Panel, Profile, ProfileSample } from '../../../types/index.ts';
import { lengthPerPixel, profileXKind } from '../field.ts';
import type { MapToolContext } from '../map-tool.ts';

/** A profile to plot: its samples, the divisor of the normalization and its color. */
export interface Series {
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

export function setupProfilePlot(mctx: MapToolContext) {
  const { ws, state } = mctx;
  const { $, viewer } = ws;

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

  return { drawProfiles, setTrace };
}

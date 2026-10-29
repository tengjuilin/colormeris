// Map tool, what the Profiles card shows for the selected profiles (pure given the result): the series to
// plot, the problem text, the length of the edited profile and the "line at" readout of the sweep. Shared by
// the card's render and the sweep's per-frame update, so both say the same.
import { invertBilinear } from '../../../core/grid.ts';
import type { ErrorResult, MapResult, Panel, Profile, ProfileSample } from '../../../types/index.ts';
import { formatNumber } from '../../project/project-files.ts';
import { mapCoord, profileDivisor } from '../field.ts';
import type { MapToolContext } from '../map-tool.ts';
import type { Series } from './profile-plot.ts';

export interface ProfileView {
  series: Series[];
  problem: string;
  /** Changes when the card's text or CSV button would change; the sweep re-renders the card only then. */
  signature: string;
}

export function profileView(mctx: MapToolContext, panel: Panel, shown: Profile[]): ProfileView {
  const { ws, state } = mctx;
  const results = (ws.resultFor(panel) as MapResult).profiles || {};
  const series: Series[] = [];
  const errors: { name: string; error: string }[] = [];
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
  const problem = once ? errors[0].error : errors.map((e) => `${e.name}: ${e.error}`).join(' ');
  return { series, problem, signature: `${series.length}|${problem}` };
}

/** Where the profile's midpoint is across the direction it sweeps, in the units of the Coordinates setting. */
export function sweepAtText(panel: Panel, sel: Profile): string {
  if (!panel.grid.corners) return '';
  const across = Math.abs(sel.b.x - sel.a.x) >= Math.abs(sel.b.y - sel.a.y) ? 'y' : 'x';
  const { u, v } = invertBilinear(panel.grid.corners, { x: (sel.a.x + sel.b.x) / 2, y: (sel.a.y + sel.b.y) / 2 });
  const c = mapCoord(panel, across);
  const value = c.at!(across === 'x' ? u : v);
  const unit = c.kind === 'px' ? ' px' : c.kind === 'length' ? ` ${panel.scale!.unit}` : '';
  return `Line at ${across} = ${c.kind === 'px' ? value.toFixed(1) : formatNumber(value)}${unit}`;
}

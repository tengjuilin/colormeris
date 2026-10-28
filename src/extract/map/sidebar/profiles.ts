// Map tool, Profiles card: the profile list, its fields, the plot hookup and the profile CSV.

import type { ErrorResult, MapResult, Panel, ProfileSample } from '../../../types/index.ts';
import { profileCsv, profilesCsv, safeFileName } from '../../project/project-files.ts';
import { lengthPerPixel, profileAxisKey, profileDivisor, profileEndForLength, profileLength } from '../field.ts';
import type { MapToolContext } from '../map-tool.ts';
import type { Series, setupProfilePlot } from './profile-plot.ts';
import type { setupMapResults } from './results.ts';
import type { setupSweep } from './sweep.ts';

/** The other cards' functions the Profiles card calls. */
export interface ProfileDeps {
  plot: ReturnType<typeof setupProfilePlot>;
  sweep: ReturnType<typeof setupSweep>;
  resultsCard: ReturnType<typeof setupMapResults>;
}

export function setupMapProfiles(mctx: MapToolContext, { plot, sweep, resultsCard }: ProfileDeps) {
  const { ws, state } = mctx;
  const { $, app } = ws;

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
    resultsCard.renderUnits(
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
    sweep.renderSweep(panel, sel);
    $('profile-csv').textContent =
      series.length > 1 ? `Download ${series.length} profiles CSV` : 'Download profile CSV';
    plot.drawProfiles(panel, series);
  }

  function bind() {
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
    $('profile-norm').addEventListener('change', (e) => {
      state.profileNorm = (e.target as HTMLSelectElement).value;
      // The fixed value axis was measured in the old scale.
      if (state.sweep) {
        const panel = ws.activePanel();
        const l = mctx.selectedProfile();
        const image = app.pages.get(panel.page)?.imageData;
        state.sweep.yRange =
          l && image
            ? sweep.sweepValueRange(image, panel, { ...l, a: state.sweep.a0, b: state.sweep.b0 }, state.sweep)
            : null;
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
        mode === 'raw'
          ? null
          : { mode, divisor: (profileDivisor(samples, mode) as { divisor?: number }).divisor ?? NaN };
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
  }

  return { renderProfiles, bind };
}

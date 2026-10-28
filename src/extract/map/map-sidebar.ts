// Map tool, DOM: the sidebar cards (Axes, Profiles, Results), the profile
// plot and the CSV downloads. Set up by map-tool.ts; each card lives in
// sidebar/ and this file composes them.
//
// mctx: { ws, state, selectedProfile, selectedProfiles, isSelected,
// selectProfile, profileColor, toggleMode, deleteSelected, AXIS_COLORS } (see
// map-tool.ts; toggleMode and deleteSelected are added after this setup and
// looked up at call time).

import type { Panel } from '../../types/index.ts';
import type { MapToolContext } from './map-tool.ts';
import { setupMapAxes } from './sidebar/axes.ts';
import { setupProfilePlot } from './sidebar/profile-plot.ts';
import { setupMapProfiles } from './sidebar/profiles.ts';
import { setupMapResults } from './sidebar/results.ts';
import { setupSweep } from './sidebar/sweep.ts';

export function setupMapSidebar(mctx: MapToolContext) {
  const { ws } = mctx;
  const { $, app } = ws;

  function renderSidebar(panel: Panel) {
    renderScale(panel);
    axes.renderAxes(panel);
    profiles.renderProfiles(panel);
    results.renderResults(panel);
  }

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

  const axes = setupMapAxes(mctx);
  const results = setupMapResults(mctx);
  const plot = setupProfilePlot(mctx);
  const sweep = setupSweep(mctx);
  const profiles = setupMapProfiles(mctx, { plot, sweep, resultsCard: results });

  axes.bind();
  profiles.bind();
  sweep.bind();
  results.bind();
  // The plot follows the card's width.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(
      () => app.sourceCanvas && ws.tool().kind === 'map' && profiles.renderProfiles(ws.activePanel()),
    ).observe($('profile-plot'));
  }

  return {
    renderSidebar,
    focusAxisTick: axes.focusAxisTick,
    setTrace: plot.setTrace,
    stopSweep: sweep.stopSweep,
    toggleSweep: sweep.toggleSweep,
  };
}

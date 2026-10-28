// Map tool, Results card: the value summary, the units select and the matrix downloads.

import type { DomEl, MapField, MapResult, MapUnits, Panel } from '../../../types/index.ts';
import { formatNumber, mapLongCsv, mapMatrixCsv } from '../../project/project-files.ts';
import { axisFn, coordKind, lengthPerPixel, mapSize } from '../field.ts';
import type { MapToolContext } from '../map-tool.ts';

export function setupMapResults(mctx: MapToolContext) {
  const { ws, state } = mctx;
  const { $, viewer } = ws;

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

  function bind() {
    // One setting for the profile plot and the matrix, edited from either card.
    for (const id of ['profile-x', 'map-units'])
      $(id).addEventListener('change', (e) =>
        ws.commit((p) => (p.map.units = (e.target as HTMLSelectElement).value as MapUnits)),
      );
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
      if (!r.error)
        ws.download(new Blob([mapMatrixCsv(p, r as MapField)], { type: 'text/csv' }), ws.csvName(p, '_map'));
    });
    $('map-dl-long').addEventListener('click', () => {
      const p = ws.activePanel();
      const r = ws.resultFor(p) as MapResult;
      if (!r.error)
        ws.download(
          new Blob([mapLongCsv([{ panel: p, result: r }])], { type: 'text/csv' }),
          ws.csvName(p, '_map_long'),
        );
    });
  }

  return { renderResults, renderUnits, bind };
}

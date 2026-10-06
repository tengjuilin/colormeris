(function (CM) {
  'use strict';
  const { rgbToLab, colorbarSamples, makeValueFn, labToT, sampleCell, dotRadius, ticksWithT, colorbarProblem } = CM;

  // Combine grid sampling and colorbar calibration into a value matrix.


  // Returns a description of what is still missing before extraction, or null.
  function panelProblem(panel) {
    if (!panel.grid.corners) return 'Set the heatmap grid corners.';
    // Dot centers give the cell spacing only with at least two dots per side.
    if (panel.grid.anchor === 'centers' && (panel.grid.rows < 2 || panel.grid.cols < 2)) return 'Dot centers need at least 2 rows and 2 columns.';
    return colorbarProblem(panel);
  }

  // Result: {rows, cols, cells[r][c] = {rgb, t, value, deltaE, flagged, radius?, empty?}, samples}
  // With dot centers each cell is sampled inside its own dot (radius in image
  // pixels); a cell without a dot is empty, with value NaN.
  // or {error} when the panel is not fully calibrated.
  function extractPanel(img, panel) {
    const error = panelProblem(panel);
    if (error) return { error };
    const cb = panel.colorbar;
    const samples = colorbarSamples(img, cb);
    const valueAt = makeValueFn(ticksWithT(cb), cb.scale);
    const { rows, cols } = panel.grid;
    // Heatmaps repeat colors a lot (flat cells, few levels), and the colorbar
    // match is the costly part, so match each distinct color once.
    const matches = new Map();
    const dots = panel.grid.anchor === 'centers';
    const cells = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const radius = dots ? dotRadius(img, panel.grid, r, c) : null;
        if (dots && !radius) {
          row.push({ rgb: null, t: NaN, value: NaN, deltaE: NaN, flagged: false, radius: null, empty: true });
          continue;
        }
        const rgb = sampleCell(img, panel.grid, r, c, radius);
        const key = rgb.join(',');
        let match = matches.get(key);
        if (!match) matches.set(key, (match = labToT(rgbToLab(rgb), samples, panel.settings.distance)));
        const { t, deltaE } = match;
        row.push({ rgb, t, value: valueAt(t), deltaE, flagged: deltaE > panel.settings.maxDeltaE, ...(dots ? { radius } : {}) });
      }
      cells.push(row);
    }
    return { rows, cols, cells, samples };
  }

  Object.assign(CM, { panelProblem, extractPanel });
})((globalThis.Colormeris ??= {}));

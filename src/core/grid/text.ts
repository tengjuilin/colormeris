// suppressText: paints over text printed in cells before borders are counted.

// ---- Text printed in cells ------------------------------------------------
//
// Values printed in the cells (one-decimal numbers on framed cells, t18)
// put more color steps across a row than its borders do: their strokes
// gave 10 rows for 5 and 21 rows for 7. Strokes of dark text are short
// dark dips on a line, darker than the cell on both sides; grid lines and
// frames are dark on most lines at the same place and stay. Each dip is
// painted over with the colors on its two sides, so a border under a
// label stays at its place. `rgb`: lines × N samples (entry (j * N + i) *
// 3), changed in place; `pxPerSample` sets the longest dip (a glyph).
// Returns the share of samples painted.
const TEXT_DARK = 110; // mean channel level of a text stroke, at most
const TEXT_CHROMA = 60; // and its chroma (black text, anti-aliased on color)
const TEXT_DIP = 60; // darker than the cell on both sides by this much
const TEXT_RUN_PX = 16; // longest stroke along a line (a digit's height)
export function suppressText(rgb: Float32Array, N: number, lines: number, pxPerSample = 1) {
  const maxRun = Math.max(2, Math.round(TEXT_RUN_PX / pxPerSample));
  const at = (j: number, i: number) => (j * N + i) * 3;
  const level = (k: number) => (rgb[k] + rgb[k + 1] + rgb[k + 2]) / 3;
  const dark = (k: number) =>
    level(k) <= TEXT_DARK &&
    Math.max(rgb[k], rgb[k + 1], rgb[k + 2]) - Math.min(rgb[k], rgb[k + 1], rgb[k + 2]) <= TEXT_CHROMA;
  // Samples dark on most lines are a grid line or frame (dark on all
  // lines but the gaps between cells; text covers half of a line at most).
  const ruled = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    let n = 0;
    for (let j = 0; j < lines; j++) n += Number(dark(at(j, i)));
    ruled[i] = n >= 0.75 * lines ? 1 : 0;
  }
  let painted = 0;
  for (let j = 0; j < lines; j++) {
    for (let i = 1; i < N - 1; i++) {
      if (ruled[i] || !dark(at(j, i))) continue;
      let e = i;
      while (e + 1 < N - 1 && !ruled[e + 1] && dark(at(j, e + 1))) e++;
      // The anti-aliased rim of the stroke goes with it.
      const a = Math.max(1, i - 1);
      const b = Math.min(N - 2, e + 1);
      const next = e;
      i = next;
      if (b - a + 1 > maxRun || ruled[a - 1] || ruled[b + 1]) continue;
      let low = Infinity;
      for (let k = a; k <= b; k++) low = Math.min(low, level(at(j, k)));
      const L = at(j, a - 1);
      const R = at(j, b + 1);
      if (level(L) - low < TEXT_DIP || level(R) - low < TEXT_DIP) continue;
      const half = (a + b) / 2;
      for (let k = a; k <= b; k++) rgb.copyWithin(at(j, k), k <= half ? L : R, (k <= half ? L : R) + 3);
      painted += b - a + 1;
    }
  }
  return painted / (N * lines);
}

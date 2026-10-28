// Comb fitting: even cell spacing that best explains the border evidence.

import type { CombFit } from './fit-evidence.ts';

// Best comb for cell size P (in samples), with the profile folded modulo
// P so all starts are scored at once. A comb is good when its teeth land on
// borders (the evidence within a few samples, nearer counts more), when it
// explains the borders (the share of all evidence on its teeth: a comb of
// 3 cells per tooth leaves 2 of 3 clear borders out) and when the middle
// 40% of its cells is flat.
export function combAt(wins: Float64Array[], b: Float64Array, P: number, total: number): CombFit {
  const B = Math.ceil(P);
  // Blurred borders wander a few samples from line to line; the teeth
  // take what is within 6% of a cell (1 to 3 samples).
  const r = Math.max(1, Math.min(3, Math.round(0.06 * P)));
  const win = wins[r];
  const teeth = new Float64Array(B);
  const flat = new Float64Array(B);
  const strong = new Float64Array(B);
  const n = new Float64Array(B);
  for (let i = 1; i < b.length - 1; i++) {
    const k = Math.floor(i % P);
    teeth[k] += win[i];
    flat[k] += b[i];
    strong[k] += Number(b[i] >= 0.5);
    n[k]++;
  }
  // Prefix sums over two turns for the circular middle windows.
  const F = new Float64Array(2 * B + 1);
  const C = new Float64Array(2 * B + 1);
  for (let k = 0; k < 2 * B; k++) {
    F[k + 1] = F[k] + flat[k % B];
    C[k + 1] = C[k] + n[k % B];
  }
  const lo = Math.round(0.3 * P);
  const hi = Math.round(0.7 * P);
  let best: CombFit = { P, phase: 0, r, score: -Infinity };
  for (let k = 0; k < B; k++) {
    if (!n[k]) continue;
    const m = C[k + hi + 1] - C[k + lo];
    const middle = m ? (F[k + hi + 1] - F[k + lo]) / m : 0;
    let near = 0;
    for (let d = -r; d <= r; d++) near += strong[(k + d + B) % B];
    // Beyond what 2r + 1 samples in every B would hold by chance.
    const chance = (2 * r + 1) / B;
    const explained = Math.max(0, (near / total - chance) / (1 - chance));
    const score = (teeth[k] / n[k]) * Math.min(1, explained) - middle;
    if (score > best.score) best = { P, phase: k, r, score };
  }
  return best;
}

// How well the comb (P, phase) explains the profile, as reported: the
// share of its inner teeth on a clear border, times the share of clear
// borders on its teeth, less the edge evidence in its cell middles. Near 1
// means every border was seen where the count puts it; the search score
// (discounted and corrected for chance) only ranks sizes.
export function combFit(fit: CombFit, b: Float64Array) {
  const { P, phase } = fit;
  const M = b.length;
  // A border's two color ramps (a blurred white line) lie within 10% of a
  // cell of its middle.
  const r = Math.max(fit.r, Math.round(0.1 * P));
  const onTooth = new Uint8Array(M);
  let teeth = 0;
  let hits = 0;
  let middle = 0;
  let midN = 0;
  for (let k = Math.ceil((r + 2 - phase) / P); phase + k * P < M - r - 2; k++) {
    const t = Math.round(phase + k * P);
    let hit = false;
    for (let i = t - r; i <= t + r; i++) (onTooth[i] = 1), (hit ||= b[i] >= 0.5);
    teeth++;
    hits += Number(hit);
  }
  let clear = 0;
  let on = 0;
  for (let i = 1; i < M - 1; i++) if (b[i] >= 0.5) clear++, (on += onTooth[i]);
  for (let k = Math.floor(-phase / P); phase + k * P < M; k++)
    for (let i = Math.ceil(phase + (k + 0.3) * P); i <= phase + (k + 0.7) * P; i++)
      if (i >= 0 && i < M) (middle += b[i]), midN++;
  if (!teeth || !clear) return 0;
  return Math.max(0, (hits / teeth) * (on / clear) - (midN ? middle / midN : 0));
}

// The comb through the borders it found, by least squares: the size
// search steps leave up to a sample of drift per cell size step, which
// over 30 rows misses the last border.
export function refineComb(fit: CombFit, b: Float64Array): CombFit {
  const { P, phase, r } = fit;
  const pts: [number, number][] = [];
  for (let k = Math.ceil(-phase / P); phase + k * P < b.length; k++) {
    const t = Math.round(phase + k * P);
    let best = -1;
    for (let i = Math.max(0, t - r); i <= Math.min(b.length - 1, t + r); i++)
      if (b[i] >= 0.5 && (best < 0 || b[i] > b[best])) best = i;
    if (best >= 0) pts.push([k, best]);
  }
  if (pts.length < 3) return fit;
  const n = pts.length;
  const mk = pts.reduce((s, [k]) => s + k, 0) / n;
  const mt = pts.reduce((s, [, t]) => s + t, 0) / n;
  let num = 0;
  let den = 0;
  for (const [k, t] of pts) (num += (k - mk) * (t - mt)), (den += (k - mk) ** 2);
  const P2 = num / den;
  if (!(Math.abs(P2 - P) < 0.05 * P)) return fit;
  return { ...fit, P: P2, phase: mt - mk * P2 };
}

// Cells of the comb (P, phase) inside the profile: each pair of teeth
// mostly inside it, less end cells whose outer tooth shows no border or
// that are blank (a margin inside the box). Teeth at or past the ends
// cannot be checked; their cells are kept unless blank.
export function combCells(fit: CombFit, wins: Float64Array[], isSep: number[], pale: number[]) {
  const { P, phase, r } = fit;
  const win = wins[r];
  const M = win.length;
  // Teeth this close to an end cannot be checked (the border may be the
  // box's own edge); they count when their cell is not blank.
  const edgeZone = (t: number) => t < r + 2 || t > M - r - 3;
  // End teeth may sit a few samples off the outer borders (sizes vary a
  // little across a rendered heatmap): they look within 15% of a cell.
  const reachOut = Math.max(r + 1, Math.round(0.15 * P));
  const present = (t: number) => {
    if (edgeZone(t)) return true;
    for (let i = Math.max(0, Math.round(t) - reachOut); i <= Math.min(M - 1, Math.round(t) + reachOut); i++)
      if (wins[0][i] >= 0.5 || isSep[i] === 2) return true;
    return false;
  };
  // An end cell that is mostly page white (a few tick marks or label
  // strokes aside) is margin, unless a dark line or a border (the frame)
  // closes it off on the outside: then it is a row of white cells (zeros
  // on a diverging map). A margin has the frame on its inside.
  const blank = (a: number, first: boolean) => {
    const lo = Math.max(0, Math.ceil(a));
    const hi = Math.min(M, a + P);
    let s = 0;
    // Most of a cell inside the box: blank only when one even color (a
    // white cell has pale neighbours on some lines, tick marks below a
    // frame do not make a cell).
    const most = hi - lo >= 0.75 * P;
    for (let i = lo; i < hi; i++) s += Number(most ? isSep[i] === 1 : pale[i]);
    if (hi <= lo || s <= 0.6 * (hi - lo)) return hi <= lo;
    const reach = 0.4 * P;
    for (let i = lo; i < hi; i++)
      if ((isSep[i] === 2 || wins[0][i] >= 0.5) && (first ? i - lo : hi - 1 - i) < reach) return false;
    return true;
  };
  const starts: number[] = [];
  // Cells with 60% of their size inside the box: a cell cut by a box a
  // few pixels small still counts; a band under half a cell past the
  // frame (tick marks, a label row) does not.
  for (let t = phase - Math.ceil(phase / P + 1) * P; t < M; t += P)
    if (t + 0.4 * P >= 0 && t + 0.6 * P <= M) starts.push(t);
  // White end cells cut by the box can be margin or white cells (zeros);
  // they are dropped and counted, for the caller to weigh.
  let white = 0;
  const keep = (t: number, outer: number) => {
    if (!present(outer)) return false;
    if (edgeZone(outer) && blank(t, outer === t)) return !++white;
    return true;
  };
  while (starts.length > 1 && !keep(starts[0], starts[0])) starts.shift();
  while (starts.length > 1 && !keep(starts[starts.length - 1], starts[starts.length - 1] + P)) starts.pop();
  return { count: starts.length, start: starts[0], end: starts[starts.length - 1] + P, white };
}

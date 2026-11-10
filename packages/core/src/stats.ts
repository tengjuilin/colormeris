// Small statistics helpers shared by the pure modules. Three medians, since
// callers rely on their differences:
//   median          a sorted copy; the mean of the two middle values when the
//                   count is even (colorbar steps, tick profiles, map bins)
//   medianInPlace   the same value, but sorts the typed array it is given:
//                   for hot loops that fill a scratch buffer per cell or bin
//   upperMedian     a sorted copy, the upper middle value and 0 for none:
//                   always one of the inputs (locate's pixel runs and widths)

export function median(v: ArrayLike<number>) {
  const s = Array.from(v).sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Typed-array sort is numeric and native, without a comparator call per pair.
export function medianInPlace(values: Float32Array | Float64Array) {
  values.sort();
  const m = values.length >> 1;
  return values.length % 2 ? values[m] : (values[m - 1] + values[m]) / 2;
}

export function upperMedian(v: ArrayLike<number>) {
  const s = Array.from(v).sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
}

/** A share as a whole percentage, e.g. 0.256 → "26%". */
export const pct = (v: number) => `${Math.round(v * 100)}%`;

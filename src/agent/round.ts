// Rounding for numbers the LLM reads (notes, snapshots): `d` decimals.

export const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

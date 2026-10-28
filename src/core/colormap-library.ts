// The colormap library (src/generated/colormap-data.json, written by
// scripts/export-mpl-colormaps.py; do not edit the JSON by hand).
// Colors are packed (`rgb`: base64 of per-channel differences, see pack_colors);
// `colors` unpacks them into 6-digit hex strings concatenated (256 samples, or the listed colors).
import raw from '../generated/colormap-data.json';
import type { ColormapData, ColormapSource, PackedColormapEntry } from '../types/index.ts';

function unpackRgb(b64: string): string {
  const s = atob(b64);
  const v = new Uint8Array(s.length);
  let hex = '';
  for (let i = 0; i < s.length; i++) {
    v[i] = (s.charCodeAt(i) + (i >= 3 ? v[i - 3] : 0)) & 255;
    hex += (v[i] < 16 ? '0' : '') + v[i].toString(16);
  }
  return hex;
}

const data = raw as unknown as { sources: ColormapSource[]; maps: Partial<PackedColormapEntry>[] };
for (const m of data.maps) {
  const rgb = m.rgb as string;
  delete m.rgb;
  let hex: string | null = null;
  Object.defineProperty(m, 'colors', { enumerable: true, get: () => (hex ??= unpackRgb(rgb)) });
}

export const cmapData = data as unknown as ColormapData;

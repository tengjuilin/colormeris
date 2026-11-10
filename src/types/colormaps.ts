// Types of the colormap viewer. The library's own types (ColormapEntry,
// ColormapSource, …) and the color types (Rgb, Lab, PixelImage) come from
// the colormeris package.

import type { Rgb } from 'colormeris';

/** One of the viewer's views of a map (common.ts VIEWS). */
export type ViewKey = 'orig' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'gray';

/** A map's colors in one view, with their lightness (viewData). */
export interface ViewData {
  colors: Rgb[];
  L?: number[];
}

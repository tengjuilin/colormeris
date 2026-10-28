// Synthetic image helpers for tests.
import type { Corners, PixelImage, Point, Rgb } from '../types/index.ts';
import { invertBilinear } from '../core/grid.ts';

export function makeImage(width: number, height: number, fill: number[] = [255, 255, 255, 255]): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(fill, i * 4);
  return { width, height, data };
}

export function setPixel(img: PixelImage, x: number, y: number, [r, g, b]: Rgb) {
  const i = (y * img.width + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = 255;
}

// Piecewise-linear RGB colormap through stops, s in [0, 1].
export function cmap(stops: Rgb[], s: number): Rgb {
  const x = Math.min(1, Math.max(0, s)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  return stops[i].map((c, k) => Math.round(c + f * (stops[i + 1][k] - c)));
}

export const VIRIDISH: Rgb[] = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

// Paint a heatmap of `matrix` (values s in [0,1]) inside a quadrilateral,
// with 1px dark grid lines between cells unless `lines` is false.
export function paintHeatmap(img: PixelImage, corners: Corners, matrix: number[][], stops: Rgb[], { lines = true }: { lines?: boolean } = {}) {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const cellW = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y) / cols;
  const cellH = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y) / rows;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const { u, v } = invertBilinear(corners, { x: x + 0.5, y: y + 0.5 });
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const fu = u * cols;
      const fv = v * rows;
      const edge = lines && (Math.min(fu % 1, 1 - (fu % 1)) * cellW < 0.5 || Math.min(fv % 1, 1 - (fv % 1)) * cellH < 0.5);
      const color = edge ? [30, 30, 30] : cmap(stops, matrix[Math.floor(fv)][Math.floor(fu)]);
      setPixel(img, x, y, color);
    }
  }
}

// Vertical colorbar from (x0..x1) spanning y0 (s=1, top) to y1 (s=0, bottom).
export function paintColorbar(img: PixelImage, x0: number, x1: number, y0: number, y1: number, stops: Rgb[]) {
  for (let y = y0; y <= y1; y++) {
    const s = (y1 - y) / (y1 - y0);
    for (let x = x0; x <= x1; x++) setPixel(img, x, y, cmap(stops, s));
  }
}

// Dot plot: a filled circle of radii[r][c] px (0 = no dot) colored by
// matrix[r][c] at each center, on the image's background. `centers` are the
// top-left and bottom-right dot centers; dots are evenly spaced between them.
export function paintDots(img: PixelImage, tl: Point, br: Point, matrix: number[][], radii: number[][], stops: Rgb[]) {
  const rows = matrix.length;
  const cols = matrix[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const R = radii[r][c];
      if (!R) continue;
      const cx = tl.x + ((br.x - tl.x) * c) / (cols - 1);
      const cy = tl.y + ((br.y - tl.y) * r) / (rows - 1);
      const rgb = cmap(stops, matrix[r][c]);
      for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++)
        for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= R * R) setPixel(img, x, y, rgb);
    }
  }
}

const fillRect = (img: PixelImage, x0: number, y0: number, x1: number, y1: number, rgb: Rgb) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) setPixel(img, x, y, rgb);
};
const outline = (img: PixelImage, x0: number, y0: number, x1: number, y1: number, rgb: Rgb = [0, 0, 0]) => {
  fillRect(img, x0, y0, x1, y0 + 1, rgb);
  fillRect(img, x0, y1 - 1, x1, y1, rgb);
  fillRect(img, x0, y0, x0 + 1, y1, rgb);
  fillRect(img, x1 - 1, y0, x1, y1, rgb);
};
// Text-like dark blocks: `n` characters 6 × 10 px, 2 px apart.
const text = (img: PixelImage, x: number, y: number, n: number) => {
  for (let i = 0; i < n; i++) fillRect(img, x + i * 8, y, x + i * 8 + 6, y + 10, [20, 20, 20]);
};

// A screenshot-like figure modelled on a 12 × 32 replicate heatmap (RLU fold
// change, Tail 1-8 … 1-1): 8 groups of 4 columns 8 px apart, pure-white 2 px
// lines between cells, a 2 px black frame, most cells pale pink (not 40
// levels off white) and the dark ones only in rows 4–8 of groups 3–6. Row
// brackets 8 px right of the frame, column labels underlined 8 px above it,
// empty legend boxes on the left and bottom right, and a horizontal colorbar
// below on the right (mid pink to dark red, framed, tick marks on its top
// edge, labels below, a title on its left). Truth in `figure`.
export function groupedFigure() {
  const img = makeImage(1000, 420);
  const X0 = 100;
  const Y0 = 50;
  const cellsX = (g: number, c: number) => X0 + 2 + g * 94 + c * 22; // 20 px of color, then a 2 px line
  const cellsY = (r: number) => Y0 + 2 + r * 20; // 18 px of color, then a 2 px line
  const pale = [[244, 222, 222], [246, 230, 230], [242, 219, 219], [236, 203, 204]];
  for (let g = 0; g < 8; g++)
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 12; r++) {
        const dark = r >= 4 && r <= 8 && g >= 2 && g <= 5;
        const rgb = dark ? [200 - 8 * c, 90 - 10 * (r - 4), 95 - 10 * (r - 4)] : pale[(r * 3 + c + g) % 4];
        const w = c === 3 ? 20 : 22;
        const h = r === 11 ? 18 : 20;
        fillRect(img, cellsX(g, c), cellsY(r), cellsX(g, c) + w, cellsY(r) + h, rgb);
        // Pure-white lines between cells.
        if (c < 3) fillRect(img, cellsX(g, c) + 20, cellsY(r), cellsX(g, c) + 22, cellsY(r) + h, [255, 255, 255]);
        if (r < 11) fillRect(img, cellsX(g, c), cellsY(r) + 18, cellsX(g, c) + w, cellsY(r) + 20, [255, 255, 255]);
      }
  const X1 = cellsX(7, 3) + 20 + 2;
  const Y1 = cellsY(11) + 18 + 2;
  outline(img, X0, Y0, X1, Y1);
  outline(img, X0 + 1, Y0 + 1, X1 - 1, Y1 - 1);
  // Column labels with underlines, row brackets, legend boxes.
  for (let g = 0; g < 8; g++) {
    text(img, cellsX(g, 0) + 8, Y0 - 24, 8);
    fillRect(img, cellsX(g, 0) + 2, Y0 - 10, cellsX(g, 3) + 18, Y0 - 8, [0, 0, 0]);
  }
  for (let k = 0; k < 3; k++) {
    fillRect(img, X1 + 8, cellsY(4 * k) + 4, X1 + 10, cellsY(4 * k + 3) + 14, [0, 0, 0]);
    for (let i = 0; i < 3; i++) fillRect(img, X1 + 16, cellsY(4 * k) + 20 + i * 14, X1 + 26, cellsY(4 * k) + 30 + i * 14, [20, 20, 20]);
  }
  for (let i = 0; i < 4; i++) {
    outline(img, X0 - 26, Y0 + 2 + i * 14, X0 - 10, Y0 + 15 + i * 14);
    text(img, X0 - 90, Y0 + 3 + i * 14, 7);
    outline(img, X1 - 64 + i * 16, Y1 + 10, X1 - 48 + i * 16, Y1 + 26);
    for (let j = 0; j < 4; j++) fillRect(img, X1 - 60 + i * 16, Y1 + 32 + j * 9, X1 - 52 + i * 16, Y1 + 39 + j * 9, [20, 20, 20]);
  }
  // Colorbar: 240 × 20 px strip inside a 1 px frame, 8 px below the cells.
  const bar = { x0: X1 - 330, y0: Y1 + 10, x1: X1 - 90, y1: Y1 + 30 };
  for (let x = bar.x0; x < bar.x1; x++) {
    const s = (x - bar.x0) / (bar.x1 - bar.x0 - 1);
    fillRect(img, x, bar.y0, x + 1, bar.y1, [Math.round(230 - 65 * s), Math.round(139 - 97 * s), Math.round(140 - 97 * s)]);
  }
  outline(img, bar.x0 - 1, bar.y0 - 1, bar.x1 + 1, bar.y1 + 1, [20, 0, 0]);
  const ticks = [0.09, 0.36, 0.64, 0.91].map((t) => Math.round(bar.x0 + t * (bar.x1 - bar.x0)));
  ticks.forEach((x, i) => {
    fillRect(img, x, bar.y0, x + 1, bar.y0 + 4, [40, 20, 20]);
    text(img, x - (i ? 12 : 3), bar.y1 + 6, i ? 3 : 1);
  });
  text(img, bar.x0 - 150, bar.y0 + 4, 16); // title
  return { img, cells: { x0: X0, y0: Y0, x1: X1, y1: Y1 }, bar, ticks, rows: 12, cols: 32 };
}

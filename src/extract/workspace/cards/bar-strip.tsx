// The sampled colorbar strip under the Colorbar card's source fields: the colors the panel reads, with a mark at
// each tick. Drawn in a layout effect keyed on what it shows, so a render that changes nothing (a keystroke in
// another field) draws nothing. Hidden until there is a colorbar or a known colormap.
import { useLayoutEffect, useRef } from 'react';
import { rgbToHex } from '../../../core/color.ts';
import { colorAtT, pointAtT } from '../../../core/colorbar.ts';
import { colormapSamples } from '../../../core/colormap-match.ts';
import { readPixel } from '../../../core/grid.ts';
import type { ColorbarSample, HeatmapResult, Panel, Point, Rgb, WorkspaceContext } from '../../../types/index.ts';
import { ticksWithT } from '../../project/project.ts';

interface Spec {
  start: Point | null;
  end: Point | null;
  colormap: { name: string; reversed?: boolean } | null;
  ticks: number[];
}

const N = 128;

function drawBarStrip(
  canvas: HTMLCanvasElement,
  spec: Spec,
  result: ColorbarSample[] | undefined,
  image: ImageData | null,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return; // jsdom has no canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Before the panel has results, a known colormap still shows its colors.
  const samples = result || (spec.colormap ? colormapSamples(spec.colormap, N) : null);
  if (!samples && (!spec.start || !spec.end || !image)) return;
  // Draw the raw sampled colors even when ticks are incomplete.
  const width = canvas.width;
  const h = canvas.height;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    let rgb: Rgb;
    if (samples) rgb = colorAtT(samples, t);
    else {
      const q = pointAtT(spec.start!, spec.end!, t);
      rgb = readPixel(image!, q.x, q.y);
    }
    ctx.fillStyle = rgbToHex(rgb);
    ctx.fillRect(Math.floor((i / N) * width), 0, Math.ceil(width / N) + 1, h);
  }
  for (const t of spec.ticks) {
    const x = Math.round(Math.min(1, Math.max(0, t)) * (width - 1));
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(x - 2, 0, 4, h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - 1, 0, 2, h);
  }
}

export function BarStrip({ w, panel }: { w: WorkspaceContext; panel: Panel }) {
  const cb = panel.colorbar;
  const image = w.app.imageData;
  // resultFor is cached, so this is a lookup; its samples change identity only when the colors change.
  const samples = (w.resultFor(panel) as HeatmapResult).samples;
  // No colorbar yet: hide the strip rather than show an empty box.
  const hidden = !samples && !cb.colormap && (!cb.start || !cb.end || !image);
  // Everything else the strip shows, as a string that changes exactly when the drawing does.
  const spec = JSON.stringify({
    start: cb.start,
    end: cb.end,
    colormap: cb.colormap,
    ticks: ticksWithT(cb)
      .map((k) => k.t)
      .filter(Number.isFinite),
  } satisfies Spec);
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (canvas.current) drawBarStrip(canvas.current, JSON.parse(spec), samples, image);
  }, [spec, samples, image]);
  return (
    <canvas
      id="bar-strip"
      ref={canvas}
      className="bar-strip"
      width={600}
      height={28}
      aria-label="Sampled colorbar"
      hidden={hidden}
    />
  );
}

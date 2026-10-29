import { memo, useMemo } from 'react';
import type { ColormapEntry } from '../../../types/index.ts';
import { el, svgEl } from '../../common.ts';
import { metrics, viewData } from '../../library-cache.ts';
import { createPlots } from '../../plots.ts';
import { getTooltip } from '../../tooltip-element.ts';
import { SvgFigure } from '../shared/svg-figure.tsx';

// The four plots of the detail view (lightness, step, chroma, hue), short
// enough to sit above the folds, captions in tooltips. Built imperatively
// (SVG with a hover guide, as in plots.ts) and hosted by <SvgFigure>; the
// builders are memoised on [map, reversed], so nothing is drawn again when the
// detail re-renders for the comparison button or a pair mark. The tooltip is
// looked up when a plot is hovered, so the kit can live at module level.

// Plot height in viewBox units, drawn at 1:1. The width follows, for a square plot box.
const PLOT_H = 150;

const rev = <T,>(a: T[], reversed = false) => (reversed ? a.slice().reverse() : a);
const kit = createPlots({
  el,
  svgEl,
  viewData,
  metrics,
  rev,
  isRev: () => false,
  showTip: (...a) => getTooltip().showTip(...a),
  hideTip: () => getTooltip().hideTip(),
});
const { profile, stepPoints, niceAxis, linePlot, figure, POS_TICKS, M, HUE_MIN_CHROMA } = kit;

interface Fig {
  key: 'L' | 'step' | 'C' | 'h';
  build: () => HTMLElement;
}

/** One builder per plot; the step plot is left out for qualitative maps. */
export function detailFigures(map: ColormapEntry, reversed: boolean): Fig[] {
  const p = profile(map, reversed);
  const { colors, m, n, qual, xOf, pts } = p;
  const [Ls, C, h] = [p.Ls, p.C, p.h] as number[][];
  const mode = qual ? 'dots' : 'line';
  const dotR = qual ? 4.5 : 1.8;
  // Three position ticks: five crowd the small square plots.
  let xTicks = POS_TICKS.filter((t) => t.x % 0.5 === 0);
  let xLabel = 'Position';
  if (qual) {
    const every = Math.ceil(n / 10);
    xTicks = [];
    for (let i = 0; i < n; i += every) xTicks.push({ x: xOf(i), label: String(i + 1) });
    xLabel = 'Color number';
  }
  const H = PLOT_H;
  const W = PLOT_H - M.t - M.b + M.l + M.r; // plot box as wide as it is tall
  const opt = { compact: true };
  const figs: Fig[] = [];

  figs.push({
    key: 'L',
    build() {
      const lin = qual ? null : { x1: 0, y1: Ls[0], x2: 1, y2: Ls[n - 1], label: 'linear' };
      return figure(
        'Lightness L*',
        linePlot({
          map,
          title: 'Lightness L*',
          yLabel: 'L*',
          yMax: 100,
          yTicks: [0, 20, 40, 60, 80, 100],
          xTicks,
          xLabel,
          points: pts(Ls, (v: number) => `L* = ${v.toFixed(1)}`),
          mode,
          ref: lin,
          dotR,
          W,
          H,
        }),
        qual ? null : 'A straight rising or falling line reads best, in color and in grayscale.',
        opt,
      );
    },
  });

  if (!qual) {
    figs.push({
      key: 'step',
      build() {
        const stepPts = stepPoints(map, { colors, n, reversed });
        const k = stepPts.length;
        const axis = niceAxis(Math.max(...stepPts.map((p) => p.y ?? 0)) * 1.05);
        const mean = m.stepStats.mean;
        return figure(
          'Perceptual step ΔE2000',
          linePlot({
            map,
            title: 'Perceptual step ΔE2000',
            yLabel: 'ΔE2000 per step',
            yMax: axis.top,
            yTicks: axis.ticks,
            xTicks,
            points: stepPts,
            mode: 'line',
            ref: { x1: 0, y1: mean, x2: 1, y2: mean, label: 'mean' },
            W,
            H,
          }),
          `ΔE2000 between neighbors, in steps of 1/${k} of the map. A flat line means equal steps in the data look like equal steps in color.`,
          opt,
        );
      },
    });
  }

  figs.push({
    key: 'C',
    build() {
      const cAxis = niceAxis(Math.max(100, Math.max(...C) * 1.05));
      return figure(
        'Chroma C*',
        linePlot({
          map,
          title: 'Chroma C*',
          yLabel: 'C*',
          yMax: cAxis.top,
          yTicks: cAxis.ticks,
          xTicks,
          xLabel,
          points: pts(C, (v: number) => `C* = ${v.toFixed(1)}`),
          mode,
          dotR,
          W,
          H,
        }),
        'Colorfulness: 0 is gray.',
        opt,
      );
    },
  });

  figs.push({
    key: 'h',
    build: () =>
      figure(
        'Hue h°',
        linePlot({
          map,
          title: 'Hue h°',
          yLabel: 'h (°)',
          yMax: 360,
          yTicks: [0, 90, 180, 270, 360],
          xTicks,
          xLabel,
          points: pts(
            h,
            (v: number) => `h = ${v.toFixed(0)}°`,
            (i: number) => C[i] < HUE_MIN_CHROMA,
          ),
          mode: 'dots',
          dotR: qual ? 4.5 : 1.8,
          W,
          H,
        }),
        `Hue wraps around at 360°, so it is drawn as dots. Colors with C* < ${HUE_MIN_CHROMA} (grays) are left out, since their hue is not defined.`,
        opt,
      ),
  });
  return figs;
}

export const DetailPlots = memo(function DetailPlots({ map, reversed }: { map: ColormapEntry; reversed: boolean }) {
  const figs = useMemo(() => detailFigures(map, reversed), [map, reversed]);
  return (
    <div className="cmap-plots cmap-detail-plots">
      {figs.map((f) => (
        <SvgFigure key={f.key} build={f.build} />
      ))}
    </div>
  );
});

import { rgbToHex } from '../../../core/color.ts';
import type { ColormapEntry, Rgb } from '../../../types/index.ts';
import { el, svgEl } from '../../common.ts';
import { metrics, viewData } from '../../library-cache.ts';
import { createPlots } from '../../plots.ts';
import { stripCanvasEl } from '../../strip-paint.ts';
import type { Tooltip } from '../../tooltip-element.ts';
import { CMP_METRICS } from './compare-model.ts';

// The four profile plots of the Compare tab with every map on the same axes,
// and their legend. Built imperatively (SVG, with a hover guide that follows
// the pointer without rendering anything) and hosted by <SvgFigure>. The
// tooltip comes in as an argument.

export interface ComparedMap {
  map: ColormapEntry;
  reversed: boolean;
}

const rev = <T>(a: T[], reversed = false) => (reversed ? a.slice().reverse() : a);

interface Series {
  points: { x: number; y: number | null; color: Rgb; pos: string; value: string }[] | null;
  mode?: 'line' | 'dots';
  dotR?: number;
}

// Points per map, direction and quantity: a change to one map (reverse, add,
// reorder) redraws the plots without rebuilding the others' points. Colormap
// data never changes, so the cache lives at module level.
const seriesCache = new Map<string, Series>();
let gradientSeq = 0; // ids of the line gradients, unique on the page

// Same tooltips as the plots of one map, so the plot row stays short.
const caps: Record<string, string> = {
  L: 'A straight rising or falling line reads best, in color and in grayscale.',
  step: 'ΔE2000 between neighboring colors. A flat line means equal steps in the data look like equal steps in color.',
  C: 'Colorfulness: 0 is gray.',
  h: '',
};

export function buildComparePlots(list: ComparedMap[], tip: Tooltip): HTMLElement {
  const { showTip, hideTip } = tip;
  const kit = createPlots({ el, svgEl, viewData, metrics, rev, isRev: () => false, showTip, hideTip });
  const { profile, stepPoints, niceAxis, drawAxes, drawSeries, figure, POS_TICKS, PW, PH, M, HUE_MIN_CHROMA } = kit;
  caps.h = `Hue wraps around at 360°, so it is drawn as dots. Colors with C* < ${HUE_MIN_CHROMA} (grays) are left out, since their hue is not defined.`;

  function buildSeries(map: ColormapEntry, reversed: boolean, key: string): Series {
    const p = profile(map, reversed);
    if (key === 'L')
      return {
        points: p.pts(p.Ls!, (v: number) => `L* = ${v.toFixed(1)}`),
        mode: p.qual ? 'dots' : 'line',
        dotR: p.qual ? 4 : 0,
      };
    if (key === 'C')
      return {
        points: p.pts(p.C, (v: number) => `C* = ${v.toFixed(1)}`),
        mode: p.qual ? 'dots' : 'line',
        dotR: p.qual ? 4 : 0,
      };
    if (key === 'h')
      return {
        points: p.pts(
          p.h,
          (v: number) => `h = ${v.toFixed(0)}°`,
          (i: number) => (p.C[i] as number) < HUE_MIN_CHROMA,
        ),
        mode: 'dots',
        dotR: p.qual ? 4 : 2.2,
      };
    // Qualitative maps have no neighbors in order, so no steps.
    if (p.qual) return { points: null };
    return { points: stepPoints(map, p), mode: 'line', dotR: 0 };
  }
  const seriesOf = (map: ColormapEntry, reversed: boolean, key: string) => {
    const id = `${map.name}|${reversed}|${key}`;
    let s = seriesCache.get(id);
    if (!s) seriesCache.set(id, (s = buildSeries(map, reversed, key)));
    return s;
  };

  function axisFor(key: string, series: { points: Series['points'] }[]) {
    const ys = series.flatMap((s) => (s.points || []).map((p) => p.y).filter((y): y is number => y != null));
    const top = Math.max(...ys, 0);
    if (key === 'L') return { yMax: 100, yTicks: [0, 20, 40, 60, 80, 100] };
    if (key === 'h') return { yMax: 360, yTicks: [0, 90, 180, 270, 360] };
    const axis = niceAxis(key === 'C' ? Math.max(100, top * 1.05) : Math.max(top * 1.05, 1));
    return { yMax: axis.top, yTicks: axis.ticks };
  }

  // One horizontal gradient per map and direction, shared by the line plots
  // (they have the same x scale): x is the position, so the color at each
  // x is the map's color there, as with one segment per sample.
  const gradDefs = svgEl('svg', { class: 'cmap-grad-defs', 'aria-hidden': 'true', focusable: 'false' });
  const defs = svgEl('defs');
  gradDefs.append(defs);
  const gradIds = new Map<string, string>();
  function lineGradient({ map, reversed }: ComparedMap, px: (t: number) => number) {
    const key = `${map.name}|${reversed}`;
    const have = gradIds.get(key);
    if (have) return have;
    const id = `cmap-cg-${++gradientSeq}`;
    const colors = viewData(map, 'orig', reversed).colors;
    const n = colors.length;
    const g = svgEl('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: px(0), x2: px(1), y1: 0, y2: 0 });
    colors.forEach((c, i) => g.append(svgEl('stop', { offset: n > 1 ? i / (n - 1) : 0, 'stop-color': rgbToHex(c) })));
    defs.append(g);
    gradIds.set(key, id);
    return id;
  }

  const miniStrip = ({ map, reversed }: ComparedMap) => {
    const d = el('span', { class: 'cmap-mini' });
    d.append(stripCanvasEl(viewData(map, 'orig', reversed).colors, map.kind === 'qualitative'));
    return d;
  };

  // One plot of one quantity with every compared map. `setActive(i)`
  // highlights map i in all four plots and the legend.
  function compareFigure(metric: (typeof CMP_METRICS)[number], setActive: (i: number) => void) {
    const W = PW;
    const H = PH;
    const m = M;
    const key = metric.key;
    const series = list.map((c) => ({ c, ...seriesOf(c.map, c.reversed, key) }));
    const svg = svgEl('svg', {
      class: 'cmap-plot',
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-label': `${metric.label} of ${list.map((x) => x.map.name).join(', ')} against position`,
    });
    const { px, py } = drawAxes(svg, {
      W,
      H,
      m,
      ...axisFor(key, series),
      xTicks: POS_TICKS,
      xLabel: 'Position',
      yLabel: metric.yLabel,
    });

    const groups = series.map((s) => {
      if (!s.points) return null;
      const g = svgEl('g', { class: 'cmap-series' });
      const stroke = s.mode === 'line' ? `url(#${lineGradient(s.c, px)})` : undefined;
      drawSeries(g, { points: s.points, mode: s.mode, dotR: s.dotR || 3, halo: true, stroke }, px, py);
      svg.append(g);
      return g;
    });

    const guide = svgEl('line', { class: 'cmap-guide', y1: m.t, y2: H - m.b, visibility: 'hidden' });
    const ring = svgEl('circle', { class: 'cmap-ring', r: 4, visibility: 'hidden' });
    svg.append(guide, ring);

    // The line closest to the pointer (by y), at the sample closest in x.
    svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const sx = ((e.clientX - r.left) / r.width) * W;
      const sy = ((e.clientY - r.top) / r.height) * H;
      const t = (sx - m.l) / (W - m.l - m.r);
      type Point = NonNullable<Series['points']>[number];
      let b: { gi: number; p: Point; d: number; map: ColormapEntry } | null = null;
      for (let gi = 0; gi < series.length; gi++) {
        const s = series[gi];
        if (!s.points) continue;
        let p: Point | null = null;
        for (const q of s.points) if (q.y != null && (!p || Math.abs(q.x - t) < Math.abs(p.x - t))) p = q;
        if (!p) continue;
        const d = Math.abs(py(p.y!) - sy);
        if (!b || d < b.d) b = { gi, p, d, map: s.c.map };
      }
      if (!b) return;
      setActive(b.gi);
      guide.setAttribute('x1', String(px(b.p.x)));
      guide.setAttribute('x2', String(px(b.p.x)));
      guide.setAttribute('visibility', 'visible');
      ring.setAttribute('cx', String(px(b.p.x)));
      ring.setAttribute('cy', String(py(b.p.y!)));
      ring.setAttribute('visibility', 'visible');
      const hex = rgbToHex(b.p.color);
      showTip(
        {
          hex,
          title: `${b.map.name} · ${metric.label}`,
          text: [hex, `rgb(${b.p.color[0]}, ${b.p.color[1]}, ${b.p.color[2]})`, b.p.pos, b.p.value],
        },
        e.clientX,
        e.clientY,
      );
    });
    svg.addEventListener('pointerleave', () => {
      guide.setAttribute('visibility', 'hidden');
      ring.setAttribute('visibility', 'hidden');
      setActive(-1);
      hideTip();
    });

    return { fig: figure(metric.label, svg, caps[key], { compact: true }), svg, groups };
  }

  // The four quantities side by side, with one legend for all of them.
  const figs: ReturnType<typeof compareFigure>[] = [];
  const legend = el('ul', { class: 'cmap-legend' });
  const lis = list.map((c, i) => {
    const li = el('li');
    li.append(el('span', { class: 'cmap-legend-name' }, c.map.name), miniStrip(c));
    li.addEventListener('pointerenter', () => setActive(i));
    li.addEventListener('pointerleave', () => setActive(-1));
    legend.append(li);
    return li;
  });
  function setActive(gi: number) {
    for (const f of figs) {
      f.svg.classList.toggle('has-active', gi >= 0);
      f.groups.forEach((g, i) => g?.classList.toggle('active', i === gi));
    }
    lis.forEach((li, i) => li.classList.toggle('active', i === gi));
  }
  const grid = el('div', { class: 'cmap-plots' });
  for (const metric of CMP_METRICS) {
    const f = compareFigure(metric, setActive);
    figs.push(f);
    grid.append(f.fig);
  }

  const wrap = el('div', { class: 'cmap-plot-wrap' });
  wrap.append(grid, legend, gradDefs);
  const qual = list.filter((c) => c.map.kind === 'qualitative').map((c) => c.map.name);
  if (qual.length) {
    wrap.append(
      el(
        'p',
        { class: 'cmap-fig-cap muted' },
        `Qualitative maps (${qual.join(', ')}) have no order: their colors are spread evenly from 0 to 1 as dots, and they have no step plot.`,
      ),
    );
  }
  return wrap;
}

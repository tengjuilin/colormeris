import type { CmapViewerContext, ColormapEntry, Rgb } from '../types/index.ts';
import { paintStrip } from './strip-paint.ts';
import { tipInfo } from './tooltip-core.ts';
import { getTooltip } from './tooltip-element.ts';

// Colormap strips (one canvas pixel per color, built when near the
// viewport), the shared tooltip, and hover / click / keyboard probing of
// any strip on the page: hex, RGB, position and L*, click to copy.
// A strip element with the bag makeStrip hangs on it.
// biome-ignore lint/suspicious/noExplicitAny: TODO(types) the _cm members are read all over the viewer
export type StripEl = HTMLElement & { _cm: any };

export function setupCmapStrips(ctx: CmapViewerContext) {
  const { el, VIEWS, viewData, root } = ctx;

  // One pixel per color, stretched by CSS (smoothed, or in blocks for
  // qualitative maps). An SVG gradient needed a <stop> per color: scrolled
  // through, the list held about 800 000 elements, and every view change or
  // filter restyled them all.
  function stripCanvas(colors: Rgb[], qualitative: boolean) {
    const n = Math.max(1, colors.length);
    const canvas = el('canvas', {
      class: qualitative ? 'cmap-paint qual' : 'cmap-paint',
      width: String(n),
      height: '1',
      'aria-hidden': 'true',
    });
    paintStrip(canvas, colors);
    return canvas;
  }

  function renderStrip(strip: StripEl) {
    const { map, view } = strip._cm;
    strip.querySelector('.cmap-paint')?.remove();
    strip.prepend(stripCanvas(viewData(map, view, strip._cm.rev).colors, map.kind === 'qualitative'));
    strip._cm.rendered = true;
  }

  // Build strips only when they come near the viewport: 87 maps x 5 strips.
  const observer =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (!e.isIntersecting) continue;
              observer!.unobserve(e.target);
              renderStrip(e.target as StripEl);
            }
          },
          { rootMargin: '400px 0px' },
        )
      : null;

  // `eager` renders at once: the comparison panel rebuilds its few strips often.
  function makeStrip(
    map: ColormapEntry,
    view: { key: string; label: string },
    eager = false,
    reversed: boolean | undefined = undefined,
  ) {
    const strip = el('div', {
      class: 'cmap-strip',
      tabindex: '0',
      role: 'img',
      'aria-label': `${map.name} ${view.label}`,
    });
    strip._cm = { map, view: view.key, rendered: false, probe: null, rev: reversed };
    strip.append(el('div', { class: 'cmap-marker', hidden: '' }));
    if (observer && !eager) observer.observe(strip);
    else renderStrip(strip);
    return strip;
  }

  // ---- shared tooltip ----

  const { showTip, hideTip, flashCopied } = getTooltip();

  // ---- strip interaction (delegated) ----

  function indexAt(strip: StripEl, clientX: number) {
    const r = strip.getBoundingClientRect();
    const n = viewData(strip._cm.map, strip._cm.view, strip._cm.rev).colors.length;
    const f = r.width ? (clientX - r.left) / r.width : 0;
    return Math.max(0, Math.min(n - 1, Math.floor(f * n)));
  }

  function probe(strip: StripEl, i: number, x: number, y: number) {
    const { map, view } = strip._cm;
    const label = VIEWS.find((v) => v.key === view)!.label;
    const vd = viewData(map, view, strip._cm.rev);
    const marker = strip.querySelector<HTMLElement>('.cmap-marker')!;
    marker.style.left = `${((i + 0.5) / vd.colors.length) * 100}%`;
    strip._cm.probe = i;
    const info = tipInfo(map, label, vd.colors, vd.L!, i);
    strip._cm.lastHex = info.hex;
    showTip(info, x, y, marker);
  }

  root.addEventListener('pointermove', (e) => {
    const strip = (e.target as Element).closest?.('.cmap-strip') as StripEl | null;
    if (!strip || !strip._cm.rendered) {
      if (!(e.target as Element).closest?.('.cmap-plot')) hideTip();
      return;
    }
    probe(strip, indexAt(strip, e.clientX), e.clientX, e.clientY);
  });
  root.addEventListener('pointerleave', hideTip);
  root.addEventListener('click', (e) => {
    const strip = (e.target as Element).closest?.('.cmap-strip') as StripEl | null;
    if (!strip) return;
    const i = indexAt(strip, e.clientX);
    probe(strip, i, e.clientX, e.clientY);
    copy(strip._cm.lastHex);
  });

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      flashCopied();
    } catch (err) {
      console.warn('Could not copy', err);
    }
  }

  // Keyboard probe: arrows move by one sample, Shift by ten, Home/End jump.
  root.addEventListener('keydown', (e) => {
    const strip = (e.target as Element).closest?.('.cmap-strip') as StripEl | null;
    if (!strip || e.target !== strip) return;
    const n = viewData(strip._cm.map, strip._cm.view, strip._cm.rev).colors.length;
    let i = strip._cm.probe ?? (e.key === 'ArrowLeft' ? n : -1);
    if (e.key === 'ArrowRight') i += e.shiftKey ? 10 : 1;
    else if (e.key === 'ArrowLeft') i -= e.shiftKey ? 10 : 1;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = n - 1;
    else if ((e.key === 'Enter' || e.key === 'c') && strip._cm.lastHex) {
      copy(strip._cm.lastHex);
      return;
    } else return;
    e.preventDefault();
    i = Math.max(0, Math.min(n - 1, i));
    const r = strip.getBoundingClientRect();
    probe(strip, i, r.left + ((i + 0.5) / n) * r.width, r.bottom - 12);
  });
  root.addEventListener('focusout', (e) => {
    if ((e.target as Element).closest?.('.cmap-strip')) hideTip();
  });

  return { stripCanvas, renderStrip, makeStrip, showTip, hideTip };
}

import { rgbToHex } from '../core/color.ts';
import type { CmapViewerContext, ColormapEntry, Rgb } from '../types/index.ts';

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
    const img = new ImageData(n, 1);
    colors.forEach((c, i) => img.data.set([c[0], c[1], c[2], 255], i * 4));
    canvas.getContext('2d')!.putImageData(img, 0, 0);
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

  const tip = el('div', { class: 'cmap-tip', role: 'tooltip', hidden: '' });
  const tipSwatch = el('span', { class: 'cmap-tip-swatch' });
  const tipTitle = el('div', { class: 'cmap-tip-title' });
  const tipLines = el('div', { class: 'cmap-tip-lines' });
  const tipCopied = el('div', { class: 'cmap-tip-copied', hidden: '' }, 'Copied');
  const tipHead = el('div', { class: 'cmap-tip-head' });
  tipHead.append(tipSwatch, tipTitle);
  tip.append(tipHead, tipLines, tipCopied);
  document.body.append(tip);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  let tipMarker: HTMLElement | null = null; // marker element to hide with the tooltip

  function tipInfo(map: ColormapEntry, viewLabel: string, colors: Rgb[], Ls: number[], i: number) {
    const n = colors.length;
    const c = colors[i];
    const hex = rgbToHex(c);
    const pos = map.kind === 'qualitative' ? `color ${i + 1} of ${n}` : `t = ${(n > 1 ? i / (n - 1) : 0).toFixed(3)}`;
    return {
      hex,
      c,
      text: [hex, `rgb(${c[0]}, ${c[1]}, ${c[2]})`, pos, `L* = ${Ls[i].toFixed(1)}`],
      title: `${map.name} · ${viewLabel}`,
    };
  }

  function placeTip(x: number, y: number) {
    // Measure first, then keep the tooltip fully inside the viewport.
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    let left = x + 14;
    let top = y + 16;
    if (left + w > vw - 4) left = x - w - 14;
    if (top + h > vh - 4) top = y - h - 12;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(4, top)}px`;
  }

  function showTip(info: { hex: string; title: string; text: string[] }, x: number, y: number) {
    tip.hidden = false;
    tipSwatch.style.background = info.hex;
    tipTitle.textContent = info.title;
    tipLines.replaceChildren(...info.text.map((t, k) => el('div', { class: k === 0 ? 'cmap-tip-hex' : '' }, t)));
    tipCopied.hidden = true;
    placeTip(x, y);
  }

  function hideTip() {
    tip.hidden = true;
    if (tipMarker) tipMarker.hidden = true;
    tipMarker = null;
  }

  function flashCopied() {
    tipCopied.hidden = false;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      tipCopied.hidden = true;
    }, 1200);
  }

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
    if (tipMarker && tipMarker !== marker) tipMarker.hidden = true;
    tipMarker = marker;
    marker.hidden = false;
    marker.style.left = `${((i + 0.5) / vd.colors.length) * 100}%`;
    strip._cm.probe = i;
    const info = tipInfo(map, label, vd.colors, vd.L!, i);
    strip._cm.lastHex = info.hex;
    showTip(info, x, y);
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

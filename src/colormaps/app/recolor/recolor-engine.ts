import { rgbToHex } from '../../../core/color.ts';
import { colorAtT, refineColorbar, sampleColorbar } from '../../../core/colorbar.ts';
import { cmapData } from '../../../core/colormap-library.ts';
import { identifyColorbar } from '../../../core/colormap-match.ts';
import type { ColorbarSample, Rgb } from '../../../types/index.ts';
import { pct, roundRgb } from '../../common.ts';
import { base } from '../../library-cache.ts';
import {
  type ColorIndex,
  createIndexer,
  newColorAt,
  recolorPixels,
  regionMask,
  similarMask,
  tAtPixel,
} from '../../recolor.ts';
import type { FigureHandle } from '../shared/figure-input.tsx';
import {
  CHUNK,
  DEFAULT_MAP,
  describeOldMap,
  downloadName,
  EMPTY_READOUT,
  fillOverlay,
  hoverReadout,
  idleReadout,
  type OldNote,
  OVERLAY_MAX,
  type Readout,
} from './recolor-model.ts';
import type { ValueStore } from './value-store.ts';

// The imperative core of the Recolor tab: calibrating the bar, indexing the
// pixels, redrawing the figure in the new colormap, the hover highlight and
// press-and-hold peek. It works on canvases and typed arrays, and tells React
// what to show through `ui` (a few state setters and the readout store); the
// pointer never renders the tab. Settings are read at call time, so the
// latest values always apply.

export interface StripColors {
  old: Rgb[];
  neu: Rgb[];
  qualitative: boolean;
}

export interface RecolorEnv {
  fig: () => FigureHandle | null;
  out: () => HTMLCanvasElement | null;
  /** The highlight canvases over the original and over the recolored copy. */
  overlays: () => [HTMLCanvasElement | null, HTMLCanvasElement | null];
  settings: () => {
    chosen: string;
    reversed: boolean;
    /** ΔE */
    tolerance: number;
    /** Share of the bar (0-1) */
    band: number;
    flash: boolean;
    drawing: boolean;
  };
  ui: {
    setStatus: (s: string) => void;
    setNote: (n: OldNote | null) => void;
    setReady: (on: boolean) => void;
    setOutShown: (on: boolean) => void;
    setStripColors: (c: StripColors | null) => void;
    setRegionCount: (n: number) => void;
    readout: ValueStore<Readout>;
  };
}

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const mapByName = new Map(cmapData.maps.map((m) => [m.name, m]));
let idMaps: { name: string; kind: string; rgbs: ReturnType<typeof base> }[] | null = null; // built once; the matcher caches each map's Lab by its colors

export function createRecolorEngine(env: RecolorEnv) {
  const { ui } = env;
  let samples: ColorbarSample[] | null = null; // the calibrated bar
  let flip = false; // the line was drawn from the old map's high end
  let index: ColorIndex | null = null; // per-pixel t and ΔE
  let region: Uint8Array | null = null; // per-pixel 0/1 from the boxes, or null for the whole image
  let outData: Uint8ClampedArray | null = null; // the recolored RGBA bytes, for the highlight's colors
  let outImage: ImageData | null = null; // the same as ImageData, to put back after a peek
  let peek: { canvas: HTMLCanvasElement; x: number; y: number } | null = null; // it shows the other version while held
  let job = 0; // the indexing run in progress; a new one cancels it
  let hoverT: number | null = null;
  let mask: Uint8Array | null = null;
  let overlayData: ImageData[] | null = null; // one buffer per overlay
  let pending: number | null = null; // the latest hover, drawn at the next frame
  let frame: ReturnType<typeof setTimeout> | number = 0;
  let renderFrame = 0;
  let stripKey: unknown[] | null = null; // what the strips show; they only change with it
  let stopped = false; // between stop() and start(): React's StrictMode mounts, unmounts and mounts again

  const newMap = () => {
    const m = (mapByName.get(env.settings().chosen) || mapByName.get(DEFAULT_MAP))!;
    return { name: m.name, kind: m.kind, rgbs: base(m) };
  };

  // ---- the figure's drawing options (figure-input reads them at event time) ----

  const base_ = () => (peek?.canvas === env.fig()?.canvas ? env.out() : null);
  const showLine = () => peek?.canvas !== env.fig()?.canvas;

  // ---- regions ----

  function updateRegion() {
    const fig = env.fig();
    if (!fig) return;
    region = fig.img ? regionMask(fig.img.width, fig.img.height, fig.boxes) : null;
    mask = null;
    ui.setRegionCount(fig.boxes.length);
    fig.redraw();
    render();
  }

  // ---- calibration ----

  function calibrate(a: { x: number; y: number }, b: { x: number; y: number }) {
    const fig = env.fig();
    const img = fig?.img;
    if (!fig || !img) return;
    const k = refineColorbar(img, a, b);
    let start = a;
    let end = b;
    let half = 2;
    if (k) {
      ({ start, end } = k);
      half = k.halfWidth;
    }
    fig.line = { start, end };
    ui.setOutShown(false);
    fig.redraw();
    const s = sampleColorbar(img, start, end, half, 256);
    if (s.length < 2) {
      ui.setStatus('That line is too short.');
      return;
    }
    samples = s;
    buildIndex(() =>
      describeOld(
        s.map((x) => x.rgb),
        Boolean(k),
      ),
    );
  }

  // Name the old map when it is a known one, and read the bar in its
  // direction, so the low end stays the low end whichever way it was drawn.
  function describeOld(rgbs: ColorbarSample['rgb'][], snapped: boolean) {
    idMaps ??= cmapData.maps.map((m) => ({ name: m.name, kind: m.kind, rgbs: base(m) }));
    const best = identifyColorbar(rgbs, idMaps)[0];
    const note = describeOldMap(best, snapped);
    flip = note.flip;
    ui.setNote(note);
  }

  // `first` runs before the pixels, after the status has been painted: naming
  // the old map compares it with every known one, a few hundred ms.
  function buildIndex(first: (() => void) | null) {
    const fig = env.fig();
    if (!fig?.img || !samples) return;
    const my = ++job;
    const ix = createIndexer(fig.img, samples);
    ui.setStatus('Reading the colors…');
    const tick = () => {
      if (my !== job || stopped) return; // a newer calibration or another image
      if (first) {
        first();
        first = null;
      }
      const done = ix.step(CHUNK);
      if (done < 1) {
        ui.setStatus(`Reading the colors… ${pct(done)}`);
        setTimeout(tick, 0);
        return;
      }
      index = ix.index;
      mask = null;
      ui.setStatus('');
      ui.setReady(true);
      renderNow();
    };
    // After a frame, so the line and the status show before the work starts.
    requestAnimationFrame(() => setTimeout(tick, 0));
  }

  // ---- recoloring ----

  // Sliders send an input event per pixel moved, and a big figure takes tens
  // of ms to recolor, so at most one redraw runs per frame.
  function render() {
    if (!index || renderFrame) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      renderNow();
    });
  }

  function renderNow() {
    const fig = env.fig();
    const out = env.out();
    if (!index || !fig?.img || !out || !samples) return;
    cancelAnimationFrame(renderFrame);
    renderFrame = 0;
    const img = fig.img;
    const m = newMap();
    const { tolerance, reversed } = env.settings();
    const r = recolorPixels(img, index, m, { tolerance, reversed, flip, region });
    if (out.width !== img.width || out.height !== img.height) {
      out.width = img.width;
      out.height = img.height;
    }
    outImage = new ImageData(r.data, img.width, img.height);
    out.getContext('2d')?.putImageData(outImage, 0, 0);
    outData = r.data;
    ui.setOutShown(true);
    const key = [samples, m.name, reversed, flip];
    if (!stripKey || key.some((v, i) => v !== stripKey?.[i])) {
      stripKey = key;
      const opt = { reversed, flip };
      ui.setStripColors({
        old: samples.map((s) => roundRgb(s.rgb)),
        neu: Array.from({ length: 128 }, (_, i) => roundRgb(newColorAt(m, i / 127, opt))),
        qualitative: m.kind === 'qualitative',
      });
    }
    ui.readout.set({ ...EMPTY_READOUT, text: idleReadout(r.changed, r.total, !!region), now: ui.readout.get().now });
    if (hoverT != null) highlight(hoverT, true);
  }

  // ---- hover highlight ----

  // Pointer events can come faster than a big image can be masked, so only
  // the latest one per frame is drawn.
  function hover(t: number) {
    pending = t;
    if (frame) return;
    const run = () => {
      frame = 0;
      if (pending != null) highlight(pending);
    };
    frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 16);
  }

  function highlight(t0: number, force = false) {
    const fig = env.fig();
    if (!index || !samples || !fig?.img) return;
    pending = null;
    const t = Math.max(0, Math.min(1, t0));
    const { band, tolerance, flash } = env.settings();
    // Pointer moves of a fraction of the band would give the same picture.
    if (!force && hoverT != null && Math.abs(t - hoverT) < band / 8) return;
    hoverT = t;
    const step = Math.ceil(Math.max(index.width, index.height) / OVERLAY_MAX);
    const res = similarMask(index, t, band, tolerance, { step, mask, region });
    mask = res.mask;
    const calm = reduceMotion() || !flash;
    overlayData ??= [];
    const shown = [fig.img.data, outData];
    env.overlays().forEach((ov, i) => {
      if (!ov || !shown[i]) return;
      if (ov.width !== res.width || ov.height !== res.height) {
        ov.width = res.width;
        ov.height = res.height;
      }
      const have = overlayData?.[i];
      if (!have || have.width !== res.width || have.height !== res.height)
        overlayData![i] = new ImageData(res.width, res.height);
      const data = overlayData![i];
      fillOverlay(new Uint32Array(data.data.buffer), res.mask, calm, shown[i]!, step, res.width, index!.width);
      ov.getContext('2d')?.putImageData(data, 0, 0);
      ov.classList.toggle('flash', !calm);
      ov.classList.add('on');
    });
    const c = roundRgb(colorAtT(samples, t));
    ui.readout.set({
      text: hoverReadout(t, res.count, res.total, !!region, band),
      hex: rgbToHex(c),
      t,
      now: Math.round(t * 100),
    });
  }

  function clearHighlight() {
    hoverT = null;
    pending = null;
    for (const ov of env.overlays()) ov?.classList.remove('on', 'flash');
    const cur = ui.readout.get();
    if (cur.t != null) ui.readout.set({ ...cur, t: null });
  }

  // Both images have the same size, so a point on either is a point on both.
  const pointOn = (c: HTMLCanvasElement, e: PointerEvent) => {
    const r = c.getBoundingClientRect();
    const k = c.width / (c.clientWidth || c.width);
    return {
      x: Math.max(0, Math.min(c.width - 1, (e.clientX - r.left - c.clientLeft) * k)),
      y: Math.max(0, Math.min(c.height - 1, (e.clientY - r.top - c.clientTop) * k)),
    };
  };

  // Press and hold either image to see the other version in its place; it
  // comes back on release, or once the press becomes a drag.
  const showPeek = () => {
    const fig = env.fig();
    const out = env.out();
    if (!fig || !out) return;
    if (peek?.canvas === out) {
      if (fig.img) out.getContext('2d')?.putImageData(fig.img, 0, 0);
    } else if (outImage) out.getContext('2d')?.putImageData(outImage, 0, 0);
    fig.redraw();
  };
  const endPeek = () => {
    if (!peek) return;
    peek = null;
    showPeek();
  };

  /** Hover, peek and highlight handlers on one of the two images; returns the cleanup. */
  function attachImage(c: HTMLCanvasElement) {
    const move = (e: PointerEvent) => {
      const fig = env.fig();
      if (!index || fig?.dragging) return;
      const p = pointOn(c, e);
      const { tolerance } = env.settings();
      const hit = tAtPixel(index, p.x, p.y, tolerance, region);
      if (hit) hover(hit.t);
      else if (hoverT != null || pending != null) clearHighlight();
    };
    const down = (e: PointerEvent) => {
      clearHighlight();
      if (!index || e.button > 0 || (env.settings().drawing && c === env.fig()?.canvas)) return;
      peek = { canvas: c, x: e.clientX, y: e.clientY };
      showPeek();
    };
    const peekMove = (e: PointerEvent) => {
      if (peek && Math.hypot(e.clientX - peek.x, e.clientY - peek.y) >= 8) endPeek();
    };
    const ends = ['pointerup', 'pointercancel', 'lostpointercapture'];
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerleave', clearHighlight);
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', peekMove);
    for (const t of ends) c.addEventListener(t, endPeek);
    return () => {
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerleave', clearHighlight);
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', peekMove);
      for (const t of ends) c.removeEventListener(t, endPeek);
    };
  }

  // ---- a new image, or Clear ----

  function reset() {
    job++;
    samples = null;
    index = null;
    outData = null;
    outImage = null;
    mask = null;
    overlayData = null;
    region = null;
    flip = false;
    clearHighlight();
    ui.setOutShown(false);
    ui.setRegionCount(0);
    ui.setReady(false);
    ui.setNote(null);
    ui.setStatus('');
    ui.readout.set(EMPTY_READOUT);
  }

  function download() {
    const fig = env.fig();
    const out = env.out();
    if (!index || !fig || !out) return;
    out.toBlob((blob) => {
      if (!blob) {
        ui.setStatus('Could not make the PNG.');
        return;
      }
      const { chosen, reversed } = env.settings();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = downloadName(fig.name, chosen, reversed);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  }

  // A stop kills the indexing run and the pending frames; a start (a remount) picks up where it was.
  const start = () => {
    stopped = false;
    if (samples && !index) buildIndex(null);
    else if (index) render();
  };
  function stop() {
    stopped = true;
    job++;
    cancelAnimationFrame(renderFrame);
    renderFrame = 0;
    if (typeof frame === 'number') cancelAnimationFrame(frame);
    else clearTimeout(frame);
    frame = 0;
  }

  return {
    calibrate,
    updateRegion,
    render,
    renderNow,
    highlight,
    hover,
    clearHighlight,
    hoverT: () => hoverT,
    attachImage,
    reset,
    download,
    start,
    stop,
    figureOptions: { base: base_, showLine },
    hasIndex: () => !!index,
  };
}

export type RecolorEngine = ReturnType<typeof createRecolorEngine>;

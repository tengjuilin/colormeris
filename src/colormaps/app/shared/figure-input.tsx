import { type CSSProperties, type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { el } from '../../common.ts';
import { createFigureInput, type FigureBox, type FigureLine, type FigureState } from '../../figure-input.ts';

// React wrapper around figure-input.ts, which stays imperative (drop zone, file
// input, pasting, the canvas with its drag). useFigureInput creates it once in a
// layout effect and destroys it with the component; <FigureInput> puts its drop
// zone and file input into the page, <FigureCanvas> its canvas (the host decides
// where, the Identify tab right below, the CVD tab inside its Original panel).
// Buttons for the bar next to Example / Clear are React nodes, rendered through
// a portal into a display: contents host the input holds.

export type FigureHandle = ReturnType<typeof createFigureInput> & { buttonsHost: HTMLElement };

export interface FigureHandlers {
  onLoad?: (file: File) => void;
  onReset?: (keepImage?: boolean) => void;
  onError?: (message: string) => void;
  onLine?: (start: { x: number; y: number }, end: { x: number; y: number }) => void;
  /** Recolor: what to draw under the line (default the image). */
  base?: () => CanvasImageSource | undefined | null;
  /** Whether to draw the line and boxes. */
  showLine?: () => boolean;
  /** 'box' to drag rectangles instead of the line. */
  dragMode?: () => string | undefined;
  /** A rectangle in image pixels, after a box drag. */
  onBox?: (box: FigureBox) => void;
  /** A click keeps the line there was. */
  keepLineOnClick?: boolean;
}

export interface FigureInputOptions {
  /** The tab this input belongs to; pasting works while getTab() returns it. */
  tab: string;
  getTab: () => string;
  /** aria-label of the canvas. */
  label: string;
  hints: { empty: string; loaded: string };
  /** false for no line at all (the CVD tab). */
  lines?: boolean;
}

export interface UseFigureInput {
  /** Null on the first render. */
  fig: FigureHandle | null;
  /** Bumped when an image loads or goes, or a line is dragged: render something that depends on the figure. */
  version: number;
  /** Loads a file; one given before the input exists waits for it (Identify hands a figure to Recolor this way). */
  load: (file: File) => void;
}

const CONTENTS: CSSProperties = { display: 'contents' };

/**
 * Creates the input once. `handlers` is read through a ref at call time, so the
 * latest closure always runs without recreating the input; that goes for the
 * option functions too (base, showLine, dragMode, onBox, keepLineOnClick).
 */
export function useFigureInput(options: FigureInputOptions, handlers: FigureHandlers): UseFigureInput {
  const [fig, setFig] = useState<FigureHandle | null>(null);
  const [version, setVersion] = useState(0);
  const live = useRef(handlers);
  live.current = handlers;
  const opts = useRef(options);
  opts.current = options;
  const waiting = useRef<File | null>(null);
  const bump = () => setVersion((v) => v + 1);
  const bumpRef = useRef(bump);
  bumpRef.current = bump;

  useLayoutEffect(() => {
    const o = opts.current;
    const buttonsHost: HTMLElement = el('span', { class: 'cmap-fig-buttons' });
    buttonsHost.style.display = 'contents';
    const made = Object.assign(
      createFigureInput({
        el,
        // figure-input reads state.tab when something is pasted.
        state: {
          get tab() {
            return opts.current.getTab();
          },
        },
        tab: o.tab,
        label: o.label,
        hints: o.hints,
        lines: o.lines,
        buttons: [buttonsHost],
        // Read at event time, so a change in the handlers is seen.
        get keepLineOnClick() {
          return live.current.keepLineOnClick;
        },
        base: () => live.current.base?.(),
        showLine: () => live.current.showLine?.() ?? true,
        dragMode: () => live.current.dragMode?.(),
        onBox: (box: FigureBox) => live.current.onBox?.(box),
        onLoad: (f: File) => {
          bumpRef.current();
          live.current.onLoad?.(f);
        },
        onReset: (keep?: boolean) => {
          bumpRef.current();
          live.current.onReset?.(keep);
        },
        onError: (msg: string) => live.current.onError?.(msg),
        onLine: (a: { x: number; y: number }, b: { x: number; y: number }) => {
          bumpRef.current();
          live.current.onLine?.(a, b);
        },
      }),
      { buttonsHost },
    );
    setFig(made);
    const f = waiting.current;
    if (f) {
      waiting.current = null;
      void made.load(f);
    }
    return () => {
      made.destroy();
      setFig(null);
    };
  }, []);

  const figRef = useRef(fig);
  figRef.current = fig;
  const load = useCallback((file: File) => {
    if (figRef.current) void figRef.current.load(file);
    else waiting.current = file;
  }, []);
  return { fig, version, load };
}

/**
 * Puts an existing DOM node into the React tree. The wrapper is display: contents
 * (no box), and CSS that styles a section's children also lists `> .cmap-slot > *`.
 */
export function Slot({ node }: { node: Node | null }) {
  const host = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const h = host.current;
    if (!h || !node) return;
    h.replaceChildren(node);
    return () => {
      if (node.parentNode === h) h.removeChild(node);
    };
  }, [node]);
  return <span ref={host} className="cmap-slot" style={CONTENTS} />;
}

/** The drop zone and the (hidden) file input, with `buttons` in the bar before Clear. */
export function FigureInput({ fig, buttons }: { fig: FigureHandle | null; buttons?: ReactNode }) {
  if (!fig) return null;
  return (
    <>
      <Slot node={fig.zone} />
      <Slot node={fig.file} />
      {buttons != null && createPortal(buttons, fig.buttonsHost)}
    </>
  );
}

/** The figure's canvas. */
export function FigureCanvas({ fig }: { fig: FigureHandle | null }) {
  return <Slot node={fig?.canvas ?? null} />;
}

export type { FigureBox, FigureLine, FigureState };

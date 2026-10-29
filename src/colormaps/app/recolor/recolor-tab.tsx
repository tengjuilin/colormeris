import { type ReactNode, useEffect, useRef, useState } from 'react';
import { pct } from '../../common.ts';
import type { FigureLine } from '../../figure-input.ts';
import { MapPicker } from '../../map-picker.tsx';
import { FigureCanvas, FigureInput, useFigureInput } from '../shared/figure-input.tsx';
import { Strip } from '../shared/strip.tsx';
import { createRecolorEngine, type RecolorEngine, type StripColors } from './recolor-engine.ts';
import {
  BAND,
  DEFAULT_MAP,
  DRAWING_HINT,
  EMPTY_HINT,
  EMPTY_READOUT,
  keyTarget,
  LOADED_HINT,
  type OldNote,
  oldNoteParts,
  type Readout,
  regionText,
  TOLERANCE,
} from './recolor-model.ts';
import { createValueStore, useStoreValue, type ValueStore } from './value-store.ts';

// The Recolor tab of the colormap viewer (colormaps.html): load a figure,
// drag along its colorbar, pick another colormap, and the figure is redrawn
// in it (recolor.ts). Pixels far from the bar's colors (background, text,
// axes) keep theirs, and so does everything outside the regions drawn with
// Draw regions, when the background shares colors with the bar. Hovering a
// color in the figure, its recolored copy or the strips flashes every pixel
// with a similar value to its complementary color. The image never leaves the
// browser.
//
// React holds the controls and what is shown; the canvases, the pixel work
// and the hover highlight are recolor-engine.ts behind refs, and the pointer
// updates only the readout and the strips' marks (a store), never the tab.

export interface RecolorTabProps {
  /** The current tab, for pasting. */
  getTab: () => string;
  /** A figure handed over from Identify, with its colorbar line; `id` makes a repeat a new request. */
  incoming: { id: number; file: File; line: FigureLine | null } | null;
}

const HINTS = { empty: EMPTY_HINT, loaded: LOADED_HINT };

function Field({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <div className="cmap-rc-field" title={title}>
      <span className="cmap-rc-label">{label}</span>
      <div className="cmap-rc-input">{children}</div>
    </div>
  );
}

function ReadoutText({ store }: { store: ValueStore<Readout> }) {
  const r = useStoreValue(store);
  return (
    <p className="cmap-rc-readout muted" aria-live="polite">
      {r.hex && <span className="cmap-sw" style={{ background: r.hex }} />}
      {r.text}
    </p>
  );
}

function OldNoteText({ note }: { note: OldNote | null }) {
  if (!note) return null;
  const { before, code, after } = oldNoteParts(note);
  return (
    <>
      {before}
      {code && <code>{code}</code>}
      {after}
    </>
  );
}

// One of the two strips: the colors of the bar, or the new ones at the same
// places. Hover or arrow keys move the highlight; the mark follows the store.
function RcStrip({
  label,
  colors,
  qualitative,
  store,
  engine,
}: {
  label: string;
  colors: StripColors['old'] | undefined;
  qualitative: boolean;
  store: ValueStore<Readout>;
  engine: RecolorEngine;
}) {
  const r = useStoreValue(store);
  const tOf = (e: { clientX: number; currentTarget: HTMLElement }) => {
    const b = e.currentTarget.getBoundingClientRect();
    return (e.clientX - b.left) / (b.width || 1);
  };
  return (
    <div
      className="cmap-id-strip cmap-rc-strip"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={r.now ?? undefined}
      onPointerMove={(e) => engine.hover(tOf(e))}
      onPointerDown={(e) => engine.highlight(tOf(e), true)}
      onPointerLeave={(e) => {
        if (document.activeElement !== e.currentTarget) engine.clearHighlight();
      }}
      onBlur={() => engine.clearHighlight()}
      onKeyDown={(e) => {
        const next = keyTarget(e.key, engine.hoverT() ?? 0.5, e.shiftKey);
        if (next == null) return;
        e.preventDefault();
        engine.highlight(next, true);
      }}
    >
      {colors && <Strip colors={colors} qualitative={qualitative} />}
      <span
        className="cmap-rc-mark"
        hidden={r.t == null}
        style={r.t == null ? undefined : { left: `${(r.t * 100).toFixed(2)}%` }}
      />
    </div>
  );
}

export function RecolorTab({ getTab, incoming }: RecolorTabProps) {
  const [chosen, setChosen] = useState(DEFAULT_MAP);
  const [reversed, setReversed] = useState(false);
  const [tolerance, setTolerance] = useState(TOLERANCE);
  const [band, setBand] = useState(BAND); // percent of the bar
  const [flash, setFlash] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [regionCount, setRegionCount] = useState(0);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState<OldNote | null>(null);
  const [ready, setReady] = useState(false); // the pixels are indexed: controls, strips and Download show
  const [origShown, setOrigShown] = useState(false);
  const [outShown, setOutShown] = useState(false);
  const [stripColors, setStripColors] = useState<StripColors | null>(null);

  const figRef = useRef<ReturnType<typeof useFigureInput>['fig']>(null);
  const outRef = useRef<HTMLCanvasElement>(null);
  const ov1 = useRef<HTMLCanvasElement>(null);
  const ov2 = useRef<HTMLCanvasElement>(null);
  const settings = useRef({ chosen, reversed, tolerance, band: band / 100, flash, drawing });
  settings.current = { chosen, reversed, tolerance, band: band / 100, flash, drawing };
  // The figure handed over from Identify; its line is used only when that very file has loaded.
  const pendingLine = useRef<{ file: File; line: FigureLine } | null>(null);

  const [readout] = useState(() => createValueStore(EMPTY_READOUT));
  const [engine] = useState(() =>
    createRecolorEngine({
      fig: () => figRef.current,
      out: () => outRef.current,
      overlays: () => [ov1.current, ov2.current],
      settings: () => settings.current,
      ui: { setStatus, setNote, setReady, setOutShown, setStripColors, setRegionCount, readout },
    }),
  );

  const { fig, load } = useFigureInput(
    {
      tab: 'recolor',
      getTab,
      label:
        'Your figure. Drag along the colorbar from its low end to its high end, then hover a color to see where it is.',
      hints: HINTS,
    },
    {
      base: engine.figureOptions.base,
      showLine: engine.figureOptions.showLine,
      keepLineOnClick: true,
      dragMode: () => (settings.current.drawing ? 'box' : 'line'),
      onBox: (box) => {
        figRef.current?.boxes.push(box);
        engine.updateRegion();
      },
      onReset: (keepImage) => {
        engine.reset();
        setDrawing(false);
        if (!keepImage) setOrigShown(false);
      },
      onLoad: (loaded) => {
        setOrigShown(true);
        const pending = pendingLine.current;
        if (pending && pending.file === loaded) {
          pendingLine.current = null;
          engine.calibrate(pending.line.start, pending.line.end);
        }
      },
      onError: (msg) => {
        setStatus(msg);
      },
      onLine: (a, b) => engine.calibrate(a, b),
    },
  );
  figRef.current = fig;

  useEffect(() => {
    engine.start();
    return () => engine.stop();
  }, [engine]);

  // The images' hover and press-and-hold handlers.
  useEffect(() => {
    const out = outRef.current;
    if (!fig || !out) return;
    const offs = [engine.attachImage(fig.canvas), engine.attachImage(out)];
    fig.canvas.classList.add('cmap-rc-canvas');
    return () => {
      for (const off of offs) off();
    };
  }, [fig, engine]);

  // Drawing regions: the canvas shows it and the hint says what to do.
  useEffect(() => {
    if (!fig) return;
    fig.canvas.classList.toggle('drawing', drawing);
    fig.hint.textContent = drawing ? DRAWING_HINT : fig.img ? LOADED_HINT : '';
  }, [fig, drawing]);
  useEffect(() => {
    if (!drawing) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && getTab() === 'recolor') setDrawing(false);
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [drawing, getTab]);

  // Redraw in the new colormap (at most once per frame); with no figure yet this does nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the settings are the triggers, the engine reads them from the ref
  useEffect(() => {
    engine.render();
  }, [engine, chosen, reversed, tolerance]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the settings are the triggers
  useEffect(() => {
    const t = engine.hoverT();
    if (t != null) engine.highlight(t, true);
  }, [engine, band, flash]);

  // From Identify: the same figure and line, recolored at once.
  const handled = useRef(0);
  useEffect(() => {
    if (!incoming || handled.current === incoming.id) return;
    handled.current = incoming.id;
    pendingLine.current = incoming.line ? { file: incoming.file, line: incoming.line } : null;
    load(incoming.file);
  }, [incoming, load]);

  const download = (
    <button type="button" className="btn small primary" hidden={!ready} onClick={() => engine.download()}>
      Download PNG
    </button>
  );

  return (
    <>
      <h2 id="cmap-recolor-title">Recolor a figure into another colormap</h2>
      <p className="muted">
        Give an image of a figure, drag along its colorbar, and pick a new colormap. Each pixel with a color of the bar
        gets the new map’s color at the same place. The image stays in your browser.
      </p>
      <FigureInput fig={fig} buttons={download} />
      <div className="cmap-rc-controls" hidden={!ready}>
        <div className="cmap-rc-fields">
          <Field
            label="New colormap"
            title="The colormap the figure is redrawn in. Type to search; leave empty to see them all."
          >
            <div>
              <MapPicker
                id="cmap-rc"
                label="New colormap"
                value={chosen}
                onChoose={(name, typedReversed) => {
                  setChosen(name);
                  if (typedReversed) setReversed(true);
                }}
              />
            </div>
            <label className="cmap-rc-check">
              <input type="checkbox" checked={reversed} onChange={(e) => setReversed(e.target.checked)} /> Reversed
            </label>
          </Field>
          <Field
            label="Match within (ΔE)"
            title="Pixels farther than this from every colorbar color keep their color (background, text, axes). Raise it for noisy or JPEG images; lower it if white or gray parts change."
          >
            <input
              type="range"
              min="2"
              max="40"
              step="1"
              value={tolerance}
              onChange={(e) => setTolerance(Number(e.target.value))}
            />
            <output>{tolerance}</output>
          </Field>
          <Field
            label="Similar within"
            title="On hover, pixels whose place on the colorbar is this close to the hovered one flash"
          >
            <input
              type="range"
              min="0.5"
              max="10"
              step="0.5"
              value={band}
              onChange={(e) => setBand(Number(e.target.value))}
            />
            <output>{pct(band / 100)}</output>
          </Field>
          <Field
            label="Highlight"
            title="On: the pixels at the hovered value flash to their complementary color. Off: they stay as they are and the rest is veiled in white."
          >
            <label className="cmap-rc-check">
              <input type="checkbox" checked={flash} onChange={(e) => setFlash(e.target.checked)} /> Flash
            </label>
          </Field>
          <Field
            label="Recolor only in"
            title="Drag rectangles on the original to recolor only inside them, for example the plot and its colorbar, so a background with colors of the bar keeps its own. Whole image removes them."
          >
            <button
              type="button"
              className={drawing ? 'btn small active' : 'btn small'}
              aria-pressed={drawing}
              onClick={() => setDrawing(!drawing)}
            >
              Draw regions
            </button>
            <button
              type="button"
              className="btn small"
              disabled={!regionCount}
              onClick={() => {
                if (figRef.current) figRef.current.boxes = [];
                engine.updateRegion();
              }}
            >
              Whole image
            </button>
            <output className="cmap-rc-region">{regionText(regionCount)}</output>
          </Field>
        </div>
      </div>
      <p className="cmap-id-status" aria-live="polite">
        {status}
      </p>
      <div className="cmap-rc-grid">
        <figure className="cmap-rc-panel" hidden={!origShown}>
          <figcaption>Original</figcaption>
          <div className="cmap-rc-stack">
            <FigureCanvas fig={fig} />
            {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: a canvas is not focusable; the highlight is decorative */}
            <canvas ref={ov1} className="cmap-rc-overlay" aria-hidden="true" />
          </div>
        </figure>
        <figure className="cmap-rc-panel" hidden={!outShown}>
          <figcaption>Recolored</figcaption>
          <div className="cmap-rc-stack">
            <canvas
              ref={outRef}
              className="cmap-id-canvas cmap-rc-canvas"
              role="img"
              aria-label="Your figure, recolored. Hover a color to see where it is."
            />
            {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: a canvas is not focusable; the highlight is decorative */}
            <canvas ref={ov2} className="cmap-rc-overlay" aria-hidden="true" />
          </div>
        </figure>
      </div>
      <ReadoutText store={readout} />
      <p className="cmap-rc-old" hidden={!note}>
        <OldNoteText note={note} />
      </p>
      <div className="cmap-rc-strips" hidden={!ready}>
        <span className="muted">Old colors, as sampled along the line</span>
        <RcStrip
          label="Colors of the old colorbar. Hover or use the arrow keys to highlight a value."
          colors={stripColors?.old}
          qualitative={false}
          store={readout}
          engine={engine}
        />
        <span className="muted">New colors</span>
        <RcStrip
          label="The new colors at the same places. Hover or use the arrow keys to highlight a value."
          colors={stripColors?.neu}
          qualitative={stripColors?.qualitative ?? false}
          store={readout}
          engine={engine}
        />
      </div>
    </>
  );
}

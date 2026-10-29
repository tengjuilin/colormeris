import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ACHROMAT, resolveCvdModel } from '../../../core/cvd.ts';
import { FigureCanvas, type FigureHandle, FigureInput, useFigureInput } from '../shared/figure-input.tsx';
import {
  caption,
  DEFAULT_TYPE,
  EXAMPLE_NAME,
  imagePixelAt,
  readoutAt,
  type SimCache,
  shownTypes,
  simulateImage,
  TYPES,
} from './cvd-model.ts';
import { createHoverStore, type HoverStore, useHover } from './hover-store.ts';

// The CVD tab of the colormap viewer (colormaps.html): a figure next to how it
// may look with a color vision deficiency (or with no color at all), after the
// DaltonLens simulator (https://daltonlens.org/colorblindness-simulator). The
// jet example is shown until the user gives an image. The simulation is in
// core/cvd.ts, the pure parts of the tab in cvd-model.ts; the image input is
// figure-input.ts (without its colorbar line). The image never leaves the
// browser. The canvases stay imperative behind refs.

export interface CvdTabProps {
  /** True while the tab is shown; the example loads the first time. */
  active: boolean;
  /** The current tab, for pasting (figure-input pastes only into its own tab). */
  getTab: () => string;
}

const EMPTY_HINT = 'Drop an image here, paste one (Ctrl/Cmd+V), or click to choose a file (PNG, JPEG, WebP or GIF).';
const HINTS = { empty: EMPTY_HINT, loaded: '' };
const SIM_KEYS = TYPES.map((t) => t[0]);

function Field({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <div className="cmap-rc-field" title={title}>
      <span className="cmap-rc-label">{label}</span>
      <div className="cmap-rc-input">{children}</div>
    </div>
  );
}

function Swatch({ hex }: { hex: string }) {
  return <span className="cmap-sw" style={{ background: hex }} title={hex} />;
}

// The marks and the readout follow the hover store; the figures do not re-render with the pointer.
function HoverMark({ store, img, on }: { store: HoverStore; img: ImageData | null; on: boolean }) {
  const h = useHover(store);
  const style =
    h && img && on
      ? { left: `${(100 * (h.x + 0.5)) / img.width}%`, top: `${(100 * (h.y + 0.5)) / img.height}%` }
      : undefined;
  return <span className="cmap-cvd-mark" hidden={!style} style={style} />;
}

function HoverReadout({
  store,
  img,
  show,
  simData,
  version,
}: {
  store: HoverStore;
  img: ImageData | null;
  show: string[];
  simData: { current: Record<string, ImageData | undefined> };
  /** Changes when the image or a finished run changes what the readout shows. */
  version: string;
}) {
  const h = useHover(store);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` stands for the simData ref's contents
  const readout = useMemo(
    () =>
      h && img
        ? readoutAt(
            img,
            show.map((key) => ({ key, data: simData.current[key] })),
            h.x,
            h.y,
          )
        : null,
    [h, img, show, simData, version],
  );
  return (
    <p className="cmap-cvd-readout muted">
      {readout && (
        <>
          Original <Swatch hex={readout.origHex} /> {readout.origHex}
          {readout.items.map((it) => (
            <span key={it.key}>
              {` · ${it.label} `}
              <Swatch hex={it.hex} />
              {` ${it.hex} (ΔE ${it.de.toFixed(1)})`}
            </span>
          ))}
        </>
      )}
    </p>
  );
}

function RefLink({ k, children }: { k: string; children: string }) {
  return <a href={`#ref-${k}`}>{children}</a>;
}

// All shown simulations (or the one) as a PNG: the single panel, or the original
// and every panel in a grid of three columns.
function downloadPng(
  fig: FigureHandle,
  shown: { k: string; c: HTMLCanvasElement }[],
  type: string,
  model: string,
  severity: number,
  onError: (msg: string) => void,
) {
  if (!fig.src || !shown.length) return;
  let c = shown[0].c;
  let what = `${shown[0].k}-${resolveCvdModel(shown[0].k, model)}-s${severity.toFixed(1)}`;
  if (type === 'all') {
    const { width: w, height: h } = fig.src;
    const gap = Math.max(4, Math.round(Math.max(w, h) / 100));
    const panes = [fig.src, ...shown.map((p) => p.c)];
    const cols = 3;
    const rows = Math.ceil(panes.length / cols);
    c = document.createElement('canvas');
    c.width = cols * w + (cols - 1) * gap;
    c.height = rows * h + (rows - 1) * gap;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    panes.forEach((src, i) => g.drawImage(src, (i % cols) * (w + gap), Math.floor(i / cols) * (h + gap)));
    what = `cvd-${model}-s${severity.toFixed(1)}`;
  }
  c.toBlob((blob) => {
    if (!blob) {
      onError('Could not make the PNG.');
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${fig.name}-${what}.png`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}

export function CvdTab({ active, getTab }: CvdTabProps) {
  const [type, setType] = useState(DEFAULT_TYPE); // or 'all'
  const [sev, setSev] = useState(1); // follows the slider
  const [simSev, setSimSev] = useState(1); // what the simulation runs with: at most one run per frame
  const [model, setModel] = useState('recommended');
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('');
  const [peek, setPeek] = useState<string | null>(null); // the simulation showing the original
  const [simVersion, setSimVersion] = useState(0); // bumped when a run finished

  const cache = useRef<SimCache>(new Map());
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const simData = useRef<Record<string, ImageData | undefined>>({});
  const peekRef = useRef<string | null>(null);
  const figRef = useRef<FigureHandle | null>(null);
  const hoverStore = useMemo(createHoverStore, []);
  // Stable ref callbacks, so React does not detach and attach the canvases on every render.
  const canvasRefs = useMemo(
    () =>
      SIM_KEYS.map((_, i) => (c: HTMLCanvasElement | null) => {
        canvases.current[i] = c;
      }),
    [],
  );

  // ---- the figure input; its canvas is the Original panel ----
  const { fig, version: imageVersion } = useFigureInput(
    { tab: 'cvd', getTab, label: 'Your figure, as it is', hints: HINTS, lines: false },
    {
      onLoad: (f) => {
        const example = f.name === EXAMPLE_NAME;
        const input = figRef.current!;
        // There is always an image: Clear goes back to the example.
        input.clear.disabled = example;
        input.hint.textContent = example
          ? 'Showing the example, a heatmap in jet. Drop, paste or choose your own image to check it.'
          : 'Drop, paste or choose another image, or Clear to go back to the example.';
        cache.current.clear();
        simData.current = {}; // the old image's simulations must not feed hover, download or peek
        setLoaded(true);
      },
      onReset: (keepImage) => {
        hoverStore.set(null);
        simData.current = {};
        if (!keepImage) setLoaded(false);
      },
      onError: setStatus,
    },
  );
  figRef.current = fig;

  // Clear goes back to the example, after figure-input's own Clear handler.
  useEffect(() => {
    if (!fig) return;
    const back = () => {
      fig.loadExample();
    };
    fig.clear.addEventListener('click', back);
    fig.canvas.classList.add('cmap-cvd-canvas');
    return () => fig.clear.removeEventListener('click', back);
  }, [fig]);

  // The example loads the first time the tab is shown.
  const started = useRef<FigureHandle | null>(null);
  useEffect(() => {
    if (!fig || !active || started.current === fig || fig.img) return;
    started.current = fig;
    fig.loadExample();
  }, [fig, active]);

  const show = useMemo(() => shownTypes(type), [type]);

  // ---- slider: at most one simulation run per frame ----
  useEffect(() => {
    if (sev === simSev) return;
    const id = requestAnimationFrame(() => setSimSev(sev));
    return () => cancelAnimationFrame(id);
  }, [sev, simSev]);

  // ---- simulate the shown kinds; a newer run (or a new image) cancels this one ----
  useEffect(() => {
    const src = fig?.img;
    if (!fig || !src) return;
    // imageVersion and the settings are the dependencies: the run reads the current image.
    void imageVersion;
    let cancelled = false;
    setStatus('');
    (async () => {
      for (const k of show) {
        const out = await simulateImage({
          src,
          kind: k,
          model,
          severity: simSev,
          cache: cache.current,
          cancelled: () => cancelled,
          onProgress: (pct) => {
            if (!cancelled) setStatus(`Simulating… ${pct}%`);
          },
        });
        if (cancelled || !out) return;
        const c = canvases.current[SIM_KEYS.indexOf(k)];
        if (c) {
          // Setting the size, even to the same one, clears and reallocates the canvas.
          if (c.width !== out.width || c.height !== out.height) {
            c.width = out.width;
            c.height = out.height;
          }
          c.getContext('2d')?.putImageData(out, 0, 0);
        }
        simData.current[k] = out;
      }
      setStatus('');
      setSimVersion((v) => v + 1); // keep the readout in step with the new settings
    })();
    return () => {
      cancelled = true;
    };
  }, [fig, imageVersion, show, model, simSev]);

  // ---- hover: the same spot on every panel, with its colors ----
  const onMove = useCallback(
    (canvas: HTMLCanvasElement, e: { clientX: number; clientY: number }) => {
      const img = figRef.current?.img;
      if (!img) return;
      const p = imagePixelAt(e.clientX, e.clientY, canvas.getBoundingClientRect(), canvas, img);
      if (p) hoverStore.set(p);
    },
    [hoverStore],
  );
  const onLeave = useCallback(() => hoverStore.set(null), [hoverStore]);
  useEffect(() => {
    const c = fig?.canvas;
    if (!c) return;
    const move = (e: PointerEvent) => onMove(c, e);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerleave', onLeave);
    return () => {
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerleave', onLeave);
    };
  }, [fig, onMove, onLeave]);

  const img = fig?.img ?? null;

  // ---- press and hold a simulation to see the original in its place ----
  const draw = (k: string) => {
    const c = canvases.current[SIM_KEYS.indexOf(k)];
    const data = simData.current[k];
    if (c && data) c.getContext('2d')?.putImageData(data, 0, 0);
  };
  const peekDown = (k: string, e: ReactPointerEvent<HTMLCanvasElement>) => {
    const src = figRef.current?.src;
    if (!src || !simData.current[k] || e.button > 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    peekRef.current = k;
    e.currentTarget.getContext('2d')?.drawImage(src, 0, 0);
    setPeek(k);
  };
  const peekBack = (k: string) => {
    if (peekRef.current !== k) return;
    peekRef.current = null;
    draw(k);
    setPeek(null);
  };

  const download = (
    <button
      type="button"
      className="btn small primary"
      hidden={!loaded}
      onClick={() => {
        if (!fig) return;
        const shown = show.flatMap((k) => {
          const c = canvases.current[SIM_KEYS.indexOf(k)];
          return c && simData.current[k] ? [{ k, c }] : [];
        });
        downloadPng(fig, shown, type, model, simSev, setStatus);
      }}
    >
      Download PNG
    </button>
  );

  const kinds = [
    ...TYPES.map(([k, label, , , tip]) => [k, label, tip] as const),
    ['all', 'All', 'All four kinds next to the original'] as const,
  ];

  return (
    <>
      <h2 id="cmap-cvd-title">Simulate color vision deficiency</h2>
      <p className="muted">
        See a figure next to how it may look to someone with a color vision deficiency (CVD), to check that its colors
        stay apart. The image stays in your browser.
      </p>
      <FigureInput fig={fig} buttons={download} />
      <div className="cmap-rc-controls" hidden={!loaded}>
        <div className="cmap-rc-fields">
          <Field
            label="Deficiency"
            title="Which kind of cone is missing (or shifted, below full severity). Gray is achromatopsia: no color at all."
          >
            {/* biome-ignore lint/a11y/useSemanticElements: the same markup as the static tab; a fieldset would change its look */}
            <div className="cmap-tabs" role="group" aria-label="Deficiency">
              {kinds.map(([k, label, tip]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={k === type}
                  title={tip}
                  aria-label={k === 'achromatopsia' ? 'Gray (achromatopsia)' : undefined}
                  onClick={() => setType(k)}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <Field
            label="Severity"
            title="1 is dichromacy (protanopia, deuteranopia, tritanopia): one kind of cone is missing. Below 1 is anomalous trichromacy (protanomaly etc.): the cone is shifted, a milder and more common form. 0 is normal vision."
          >
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={sev}
              onChange={(e) => setSev(Number(e.target.value))}
            />
            <output>{sev.toFixed(1)}</output>
          </Field>
          <Field
            label="Model"
            title="Recommended follows the DaltonLens review: Brettel 1997 for tritan, Machado 2009 for protan and deutan (it models partial severity best). Viénot 1999 does not model tritan; Brettel 1997 is used instead. Gray needs no model."
          >
            <select value={model} disabled={type === ACHROMAT} onChange={(e) => setModel(e.target.value)}>
              <option value="recommended">Recommended</option>
              <option value="brettel">Brettel 1997</option>
              <option value="vienot">Viénot 1999 (protan, deutan)</option>
              <option value="machado">Machado 2009</option>
            </select>
          </Field>
        </div>
      </div>
      <p className="cmap-id-status" aria-live="polite">
        {status}
      </p>
      <div className={type === 'all' ? 'cmap-cvd-grid all' : 'cmap-cvd-grid'} hidden={!loaded}>
        <figure className="cmap-cvd-panel">
          <figcaption>Original</figcaption>
          <div className="cmap-cvd-stack">
            <FigureCanvas fig={fig} />
            <div className="cmap-cvd-marks" aria-hidden="true">
              <HoverMark store={hoverStore} img={img} on />
            </div>
          </div>
        </figure>
        {TYPES.map(([k, , name], i) => {
          return (
            <figure key={k} className="cmap-cvd-panel" hidden={!show.includes(k)}>
              <figcaption>{peek === k ? 'Original (release to go back)' : caption(k, simSev, model)}</figcaption>
              <div className="cmap-cvd-stack">
                <canvas
                  ref={canvasRefs[i]}
                  className="cmap-id-canvas cmap-cvd-canvas"
                  role="img"
                  aria-label={`${name} simulation`}
                  onPointerMove={(e) => onMove(e.currentTarget, e)}
                  onPointerLeave={onLeave}
                  onPointerDown={(e) => peekDown(k, e)}
                  onPointerUp={() => peekBack(k)}
                  onPointerCancel={() => peekBack(k)}
                  onLostPointerCapture={() => peekBack(k)}
                />
                <div className="cmap-cvd-marks" aria-hidden="true">
                  <HoverMark store={hoverStore} img={img} on={show.includes(k)} />
                </div>
              </div>
            </figure>
          );
        })}
      </div>
      <HoverReadout
        store={hoverStore}
        img={img}
        show={show}
        simData={simData}
        version={`${imageVersion}.${simVersion}`}
      />
      <p className="cmap-fig-cap muted" hidden={!loaded}>
        Simulated in linear sRGB with <RefLink k="brettel">Brettel et al. 1997</RefLink>,{' '}
        <RefLink k="vienot">Viénot et al. 1999</RefLink> (both with libDaltonLens’ parameters) or{' '}
        <RefLink k="machado">Machado et al. 2009</RefLink>; Recommended follows the{' '}
        <RefLink k="daltonlens">DaltonLens review</RefLink>. Gray shows each color as the gray of the same luminance
        (CIELAB L*). A simulation shows which colors become hard to tell apart, not exactly what any one person sees.
        Hover to compare colors; press and hold a simulation to see the original.
      </p>
    </>
  );
}

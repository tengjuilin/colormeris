import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { rgbToHex } from '../../../core/color.ts';
import { refineColorbar, sampleColorbar } from '../../../core/colorbar.ts';
import { cmapData } from '../../../core/colormap-library.ts';
import { identifyColorbar, identifyColors } from '../../../core/colormap-match.ts';
import type { Rgb } from '../../../types/index.ts';
import { clamp8, roundRgb } from '../../common.ts';
import type { FigureLine } from '../../figure-input.ts';
import { base } from '../../library-cache.ts';
import { FigureCanvas, type FigureHandle, FigureInput, useFigureInput } from '../shared/figure-input.tsx';
import { Strip } from '../shared/strip.tsx';
import { describeMatches, identifyMaps, wholeImagePixels } from './identify-model.ts';
import { IdentifyResults, type Outcome } from './identify-results.tsx';

// The Identify tab of the colormap viewer (colormaps.html): load an image of a
// figure, drag along its colorbar (or use the whole image), and list the closest
// known maps. The image input is figure-input.ts, the pure parts are in
// identify-model.ts, the verdict and list in identify-results.tsx.

export interface IdentifyTabProps {
  /** The current tab, for pasting. */
  getTab: () => string;
  /** The maps in the comparison (the Compare buttons follow it). */
  compared: readonly string[];
  /** Show a map in Browse. */
  onShowRow: (name: string) => void;
  /** Add a map to the comparison. */
  onCompare: (name: string, on: boolean) => void;
  /** Open the figure in Recolor, with its colorbar line. */
  onRecolor: (file: File, line: FigureLine | null) => void;
}

const EMPTY_HINT = 'Drop an image here, paste one (Ctrl/Cmd+V), or click to choose a file (PNG, JPEG, WebP or GIF).';
const HINTS = {
  empty: EMPTY_HINT,
  loaded:
    'Drag along the colorbar from one end to the other. Drag from the low end to the high end to read the direction. Or use the whole image if there is no colorbar.',
};
const hexOf = (rgb: Rgb) => rgbToHex(rgb.map(clamp8));
const byName = new Map(cmapData.maps.map((m) => [m.name, m]));

export function IdentifyTab({ getTab, compared, onShowRow, onCompare, onRecolor }: IdentifyTabProps) {
  const [canWhole, setCanWhole] = useState(false);
  const [sampled, setSampled] = useState<{ rgbs: Rgb[]; snapped: boolean } | null>(null);
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const runId = useRef(0); // a newer drag or a reset makes an older run drop its result
  const figRef = useRef<FigureHandle | null>(null);

  const clearResults = () => {
    runId.current++; // drop a match still waiting for its paint
    setPending(false);
    setSampled(null);
    setOutcome(null);
    setStatus('');
  };

  // Matching every map takes a few hundred ms. Say so and let the browser paint
  // the line and the message first.
  const afterPaint = (work: () => void) => {
    const id = ++runId.current;
    setStatus(`Matching against ${cmapData.maps.length} colormaps…`);
    setOutcome(null); // the last figure's results would read as this one's while it runs
    setPending(true);
    requestAnimationFrame(() =>
      setTimeout(() => {
        if (id !== runId.current) return;
        setPending(false);
        setStatus('');
        work();
      }, 0),
    );
  };
  useEffect(
    () => () => {
      runId.current++;
    },
    [],
  );

  const runColorbar = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const fig = figRef.current;
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
    fig.redraw();
    const samples = sampleColorbar(img, start, end, half, 256);
    if (samples.length < 2) {
      fig.fail('That line is too short.');
      return;
    }
    const rgbs = samples.map((s) => s.rgb);
    setSampled({ rgbs: rgbs.map(roundRgb), snapped: !!k });
    const { lastFile, line } = fig;
    afterPaint(() =>
      setOutcome({ mode: 'bar', results: identifyColorbar(rgbs, identifyMaps()), file: lastFile, line }),
    );
  };

  const runWhole = () => {
    const fig = figRef.current;
    const img = fig?.img;
    if (!fig || !img) return;
    fig.line = null;
    fig.redraw();
    const px = wholeImagePixels(img);
    setSampled(null);
    afterPaint(() =>
      setOutcome({ mode: 'whole', results: identifyColors(px, identifyMaps()), file: null, line: null }),
    );
  };

  const { fig } = useFigureInput(
    {
      tab: 'identify',
      getTab,
      label: 'Your figure. Drag along the colorbar from one end to the other.',
      hints: HINTS,
    },
    {
      onLoad: () => setCanWhole(true),
      onReset: (keepImage) => {
        clearResults();
        if (!keepImage) setCanWhole(false);
      },
      onError: setStatus,
      onLine: runColorbar,
    },
  );
  figRef.current = fig;

  const desc = useMemo(() => (outcome ? describeMatches(outcome.results) : null), [outcome]);

  // What the status line says besides "Matching…" and errors: the direction of a colorbar match.
  let note: ReactNode = null;
  if (outcome?.mode === 'whole')
    note = 'The direction cannot be known this way. A line along the colorbar is more reliable.';
  else if (outcome && desc?.best.reversed) {
    const map = byName.get(desc.best.name);
    const last = map ? base(map).slice(-1)[0] : null;
    note = last ? (
      <>
        Reversed means the end where you started is the map’s last color{' '}
        <span className="cmap-sw" style={{ background: hexOf(last) }} title={hexOf(last)} />.
      </>
    ) : null;
  }

  const show = useCallback((name: string) => onShowRow(name), [onShowRow]);
  const compare = useCallback((name: string) => onCompare(name, true), [onCompare]);

  return (
    <>
      <h2 id="cmap-identify-title">Identify a colormap from a figure</h2>
      <p className="muted">
        Give an image of a figure and find which Matplotlib, CMasher, Crameri, cmocean, colorcet, seaborn, CarbonPlan,
        NCL, SciVisColor, CARTOColors, MATLAB or R packages colormap it uses. The image stays in your browser.
      </p>
      <FigureInput
        fig={fig}
        buttons={
          <button type="button" className="btn small" disabled={!canWhole} onClick={runWhole}>
            Use the whole image
          </button>
        }
      />
      <FigureCanvas fig={fig} />
      <div className="cmap-id-sampled" hidden={!sampled}>
        {sampled && (
          <>
            <span className="muted">
              {sampled.snapped ? 'Colors along the line (snapped to the colorbar)' : 'Colors along the line'}
            </span>
            <div className="cmap-id-strip" role="img" aria-label="Sampled colors">
              <Strip colors={sampled.rgbs} />
            </div>
          </>
        )}
      </div>
      <p className="cmap-id-status" aria-live="polite">
        {status || note}
      </p>
      <IdentifyResults
        outcome={outcome}
        desc={desc}
        pending={pending}
        compared={compared}
        onShow={show}
        onCompare={compare}
        onRecolor={onRecolor}
      />
    </>
  );
}

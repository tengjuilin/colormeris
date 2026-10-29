import { memo, useState } from 'react';
import { rgbToHex } from '../../../core/color.ts';
import { lightnessStats } from '../../../core/cvd.ts';
import type { ColormapEntry, ViewKey } from '../../../types/index.ts';
import { pct, VIEWS } from '../../common.ts';
import { metrics, sepOf, viewData } from '../../library-cache.ts';
import { READ_DE, READ_WINDOW, worstCvd } from '../../metrics.ts';
import { Strip } from '../shared/strip.tsx';

// The folded parts of the detail view with numbers: the lightness statistics,
// the table with one row per view (smallest separation and how well values
// read back; hovering a row marks the confused pair on its strip above), and
// the zones where values get confused. Same markup as the old detail-drawer.ts.

interface MapProps {
  map: ColormapEntry;
  reversed: boolean;
}

export const StatsList = memo(function StatsList({ map, reversed }: MapProps) {
  const s = lightnessStats(viewData(map, 'orig', reversed).L!);
  const item = (label: string, value: string) => (
    <li key={label}>
      <span className="muted">{`${label}: `}</span>
      <strong>{value}</strong>
    </li>
  );
  const range = item('L* range', `${s.range[0].toFixed(0)}–${s.range[1].toFixed(0)}`);
  if (map.kind === 'qualitative')
    return (
      <ul className="cmap-stats">
        {range}
        <li className="muted">Qualitative colors have no order, so monotonicity, linearity and steps do not apply.</li>
      </ul>
    );
  const st = metrics(map).stepStats;
  return (
    <ul className="cmap-stats">
      {item('Monotonic', `${s.monotonic ? 'yes' : 'no'} (${s.reversals} reversal${s.reversals === 1 ? '' : 's'})`)}
      {item('Linearity R² (line fit)', s.r2 == null ? '— (flat)' : s.r2.toFixed(3))}
      {item('Max deviation from linear', `${s.maxDev.toFixed(1)} L*`)}
      {range}
      {item('Steps', `mean ΔE ${st.mean.toFixed(2)}, max ${st.max.toFixed(2)}, variation CV ${st.cv.toFixed(2)}`)}
    </ul>
  );
});

const COLS = ['View', 'Min', 'Between', 'Confused', 'Levels', 'Flat', 'Ambiguous'];
const TIPS = [
  null,
  'Smallest ΔE2000 (ΔL* for grayscale)',
  null,
  'The two colors that are closest',
  `Distinguishable levels from end to end (each ${READ_DE} ΔE apart)`,
  `Share where values ${pct(READ_WINDOW)} apart look almost the same`,
  'Share whose color has a look-alike at least 10% away',
];

export interface ViewTableProps extends MapProps {
  /** A row was hovered (`ts`: the positions of its confused pair) or left (null). */
  onPair: (view: ViewKey, ts: number[] | null) => void;
}

export const ViewTable = memo(function ViewTable({ map, reversed, onPair }: ViewTableProps) {
  const qual = map.kind === 'qualitative';
  const m = metrics(map);
  const r = m.readability as Record<string, { levels: number; flat: number; ambiguous: number }> | null;
  const worst = worstCvd(m);
  return (
    <div className="cmap-table-wrap">
      <table className="cmap-sep">
        <caption>
          {qual
            ? 'Smallest difference between any two colors'
            : `Smallest difference between values at least 10% apart, and reading values back (differences under ${READ_DE} ΔE are not relied on)`}
        </caption>
        <thead>
          <tr>
            {COLS.map((t, i) => (
              <th key={t} scope="col" title={TIPS[i] ?? undefined}>
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {VIEWS.map((v) => {
            const s = sepOf(map, v.key, reversed);
            if (!s) return null;
            const colors = viewData(map, v.key, reversed).colors;
            const n = colors.length;
            const idx = s.t.map((t) => (qual ? t : Math.round(t * (n - 1))));
            const x = r?.[v.key];
            const cells = x ? [String(x.levels), pct(x.flat), pct(x.ambiguous)] : ['—', '—', '—'];
            return (
              <tr
                key={v.key}
                className={v.key === worst ? 'worst' : undefined}
                onPointerEnter={() => onPair(v.key, s.t)}
                onPointerLeave={() => onPair(v.key, null)}
              >
                <th scope="row">
                  {v.label}
                  {v.key === worst && <span className="cmap-worst-tag"> worst</span>}
                </th>
                <td>{`${s.min.toFixed(1)} ${v.key === 'gray' ? 'ΔL*' : 'ΔE'}`}</td>
                <td>{qual ? `${s.t[0] + 1} ↔ ${s.t[1] + 1}` : `${s.t[0].toFixed(2)} ↔ ${s.t[1].toFixed(2)}`}</td>
                <td className="cmap-sep-sw">
                  {idx.map((i, k) => {
                    const hex = rgbToHex(colors[i]);
                    // biome-ignore lint/suspicious/noArrayIndexKey: two swatches, fixed order
                    return <span key={k} className="cmap-sw" style={{ background: hex }} title={hex} />;
                  })}
                </td>
                {cells.map((t, k) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: three fixed columns
                  <td key={k}>{t}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

// Spans are on the original map; flip them when the map is shown reversed.
type Span = [number, number];
const spansOf = (spans: Span[], reversed: boolean): Span[] =>
  reversed ? spans.map(([a, b]): Span => [1 - b, 1 - a]).reverse() : spans;

function Track({ label, cls, spans, what }: { label: string; cls: string; spans: Span[]; what: string }) {
  return (
    <>
      <span className="cmap-track-label">{label}</span>
      <div
        className={`cmap-track ${cls}`}
        role="img"
        aria-label={
          spans.length
            ? `${label}: ${spans.map(([a, b]) => `${a.toFixed(2)} to ${b.toFixed(2)}`).join(', ')}`
            : `${label}: none`
        }
      >
        {spans.map(([a, b]) => (
          <span
            key={`${a}-${b}`}
            title={`${what}: t = ${a.toFixed(2)}–${b.toFixed(2)}`}
            style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%` }}
          />
        ))}
      </div>
    </>
  );
}

// The strip with two thin tracks below it: where values are flat, and where a
// color has a look-alike elsewhere. Positions are percentages, so it scales.
function ReadTracks({ map, reversed, view }: MapProps & { view: ViewKey }) {
  const r = (metrics(map).readability as unknown as Record<string, { flatSpans: Span[]; ambiguousSpans: Span[] }>)[
    view
  ];
  return (
    <div className="cmap-tracks">
      <span />
      <div
        className="cmap-track-strip"
        role="img"
        aria-label={`${map.name} ${VIEWS.find((v) => v.key === view)!.label}`}
      >
        <Strip colors={viewData(map, view, reversed).colors} />
      </div>
      <Track label="Flat" cls="flat" spans={spansOf(r.flatSpans, reversed)} what="Flat" />
      <Track
        label="Ambiguous"
        cls="ambiguous"
        spans={spansOf(r.ambiguousSpans, reversed)}
        what="Look-alike elsewhere"
      />
    </div>
  );
}

// Starts on the worst CVD view: the colormap as seen is usually the least interesting.
// Give it key={map.name} so another map starts on its own worst view.
export function Zones({ map, reversed }: MapProps) {
  const [view, setView] = useState<ViewKey>(() => worstCvd(metrics(map)) as ViewKey);
  return (
    <div className="cmap-read">
      {/* biome-ignore lint/a11y/useSemanticElements: the same group of toggle buttons as the other tabs */}
      <div className="cmap-tabs" role="group" aria-label="View for the zones">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" aria-pressed={v.key === view} onClick={() => setView(v.key)}>
            {v.label}
          </button>
        ))}
      </div>
      <div className="cmap-read-holder">
        <ReadTracks map={map} reversed={reversed} view={view} />
      </div>
      <p className="cmap-fig-cap muted">
        {`Flat: values ${pct(READ_WINDOW)} of the range apart look almost the same. Ambiguous: the color also appears at a value at least 10% away, so it could mean either.`}
      </p>
    </div>
  );
}

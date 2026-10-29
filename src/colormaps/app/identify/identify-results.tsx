import { memo } from 'react';
import { cmapData } from '../../../core/colormap-library.ts';
import { pct } from '../../common.ts';
import type { FigureLine } from '../../figure-input.ts';
import { COMPARE_MAX } from '../../route.ts';
import { Strip } from '../shared/strip.tsx';
import type { MatchGroup, MatchLevel, Scored } from './identify-model.ts';
import { miniColors } from './identify-model.ts';

// The verdict line, the ranked list and the score note of the Identify tab.

export interface Outcome {
  /** 'bar': a line along the colorbar; 'whole': all the colors of the image. */
  mode: 'bar' | 'whole';
  results: readonly Scored[];
  /** The figure and its line when it ran, for "Recolor this figure". */
  file: File | null;
  line: FigureLine | null;
}

export interface Description {
  groups: MatchGroup[];
  best: Scored;
  level: MatchLevel;
}

const kindOf = new Map(cmapData.maps.map((m) => [m.name, m.kind]));

function Verdict({
  outcome,
  desc,
  onRecolor,
}: {
  outcome: Outcome | null;
  desc: Description | null;
  onRecolor: () => void;
}) {
  if (!outcome) return null;
  let main: React.ReactNode;
  if (!desc) main = 'Could not find any colors to match.';
  else {
    const { best, level } = desc;
    const nm = best.reversed ? `${best.name} (reversed)` : best.name;
    const sc = best.score.toFixed(1);
    if (level === 'exact')
      main = (
        <>
          Best match: <strong>{nm}</strong>
          {` (ΔE ${sc}).`}
        </>
      );
    else if (level === 'close')
      main = (
        <>
          Closest: <strong>{nm}</strong>
          {` (ΔE ${sc}). Not an exact match; it may be a relative or a map from another library.`}
        </>
      );
    else main = `No good match among the known colormaps (best ΔE ${sc}).`;
  }
  return (
    <>
      {main}
      {outcome.mode === 'bar' ? (
        <>
          {' '}
          <button
            type="button"
            className="btn small"
            title="Open this figure in Recolor with the same colorbar, to redraw it in another colormap"
            onClick={onRecolor}
          >
            Recolor this figure
          </button>
        </>
      ) : (
        ' Whole image: the score is how close the image’s colors are to the nearest color of each map.'
      )}
    </>
  );
}

const Item = memo(function Item({
  group,
  inComparison,
  full,
  onShow,
  onCompare,
}: {
  group: MatchGroup;
  inComparison: boolean;
  full: boolean;
  onShow: (name: string) => void;
  onCompare: (name: string) => void;
}) {
  const { lead, ties } = group;
  return (
    <li className="cmap-id-item">
      <span className="cmap-mini">
        <Strip colors={miniColors(lead.name, !!lead.reversed)} qualitative={kindOf.get(lead.name) === 'qualitative'} />
      </span>
      <span className="cmap-id-name">
        <code>{lead.name}</code>
        {lead.reversed && ' (reversed)'}
        {ties.length > 0 && (
          <span className="muted">
            {` (same colors: ${ties.map((t) => (t.reversed ? `${t.name} reversed` : t.name)).join(', ')})`}
          </span>
        )}
      </span>
      <span className="cmap-id-score">
        {`ΔE ${lead.score.toFixed(1)}${lead.coverage != null ? `, covers ${pct(lead.coverage)}` : ''}`}
      </span>
      <span className="cmap-id-actions">
        <button
          type="button"
          className="btn small"
          aria-label={`Show ${lead.name} in Browse`}
          // The list is in its own tab, so say this before leaving.
          title={
            lead.reversed
              ? `${lead.name} matches reversed. In Browse, turn on Reversed (under ⋯) to see it that way.`
              : undefined
          }
          onClick={() => onShow(lead.name)}
        >
          Show
        </button>
        <button
          type="button"
          className="btn small"
          aria-label={`Compare ${lead.name}`}
          disabled={inComparison || full}
          onClick={() => onCompare(lead.name)}
        >
          {inComparison ? 'In comparison' : 'Compare'}
        </button>
      </span>
    </li>
  );
});

export interface IdentifyResultsProps {
  outcome: Outcome | null;
  desc: Description | null;
  /** A match is running. */
  pending: boolean;
  compared: readonly string[];
  onShow: (name: string) => void;
  onCompare: (name: string) => void;
  onRecolor: (file: File, line: FigureLine | null) => void;
}

export function IdentifyResults({
  outcome,
  desc,
  pending,
  compared,
  onShow,
  onCompare,
  onRecolor,
}: IdentifyResultsProps) {
  const full = compared.length >= COMPARE_MAX;
  return (
    <>
      <p className="cmap-id-verdict" aria-live="polite">
        <Verdict
          outcome={outcome}
          desc={desc}
          onRecolor={() => {
            if (outcome?.file) onRecolor(outcome.file, outcome.line);
          }}
        />
      </p>
      <ol className="cmap-id-list" aria-busy={pending ? 'true' : undefined}>
        {desc?.groups.map((g) => (
          <Item
            key={g.lead.name + (g.lead.reversed ? '_r' : '')}
            group={g}
            inComparison={compared.includes(g.lead.name)}
            full={full}
            onShow={onShow}
            onCompare={onCompare}
          />
        ))}
      </ol>
      <p className="cmap-fig-cap muted" hidden={!desc}>
        The score is the average ΔE2000 between the sampled colors and the map (the worst 10% are ignored). Below 3 is
        the same map; 3 to 6 is a close relative.
      </p>
    </>
  );
}

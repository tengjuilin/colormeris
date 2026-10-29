import { forwardRef, memo } from 'react';
import { cmapData } from '../../core/colormap-library.ts';
import { RATING_COLS } from '../common.ts';
import { ratingMethod } from '../metrics.ts';
import { CMAP_REFS } from '../references.ts';
import { REF_NUMBERS } from './ref-numbers.ts';

// "About the ratings, methods and references" (the footer).
// References are numbered in order of first use in the default list
// (REF_NUMBERS). MethodList is also the body of the "?" popover in the Browse
// header.

/** How each rating is made. */
export function MethodList() {
  const text = ratingMethod() as Record<string, string>;
  return (
    <ul>
      {RATING_COLS.map((c) => (
        <li key={c.key}>
          <strong>{`${c.label}. `}</strong>
          {text[c.key]}
        </li>
      ))}
    </ul>
  );
}

/** One reference; `id: false` leaves the anchor off (copies keep the footer's). */
export function RefItem({ k, id = true }: { k: string; id?: boolean }) {
  const ref = CMAP_REFS[k];
  return (
    <li id={id ? `ref-${k}` : undefined}>
      {ref.text}
      {ref.url && (
        <>
          {' '}
          {/* biome-ignore lint/a11y/noAmbiguousAnchorText: the detail view's links read the same */}
          <a href={ref.url} target="_blank" rel="noopener">
            Link
          </a>
        </>
      )}
    </li>
  );
}

const METHOD_REFS = ['machado', 'cielab', 'ciede2000', 'brettel', 'vienot', 'daltonlens'];

// A family whose members share one version (the R packages, from paletteer) is named once;
// the Python packages each have their own.
function dataSources(): string {
  const shared = (fam: string) =>
    new Set(cmapData.sources.filter((s) => s.family === fam).map((s) => s.version)).size === 1;
  const versions = [
    ...new Map(
      cmapData.sources.map((src) =>
        src.family && shared(src.family)
          ? [src.family, `${src.family} (${src.version})`]
          : [src.key, `${src.label} ${src.version}`],
      ),
    ).values(),
  ];
  return `Colormap data comes from ${versions.slice(0, -1).join(', ')}${versions.length > 1 ? ' and ' : ''}${versions.at(-1)}.`;
}

const SOURCES_TEXT = dataSources();

export const Footer = memo(
  forwardRef<HTMLDetailsElement>(function Footer(_props, ref) {
    return (
      <details className="cmap-about" id="cmap-about" ref={ref}>
        <summary>About the ratings, methods and references</summary>
        <h3>How the ratings work</h3>
        <p>
          Each colormap gets up to four ratings: yes (✓), partly (~) or no (✕). They are rules of thumb tuned on the
          Matplotlib maps, not standards. Hover a rating for the numbers.
        </p>
        <MethodList />
        <p className="muted">
          A ΔE2000 of about 2 is roughly the smallest difference you notice side by side. Color differences use
          CIEDE2000 (<a href="#ref-ciede2000">Sharma, Wu &amp; Dalal 2005</a>).
        </p>
        <h3>References</h3>
        <ol>
          {[...REF_NUMBERS.keys()].map((k) => (
            <RefItem key={k} k={k} />
          ))}
        </ol>
        <h3>Methods</h3>
        <p className="muted">
          CVD views simulate Machado et al. (2009) at full severity in linear RGB, the same model matplotlib’s docs use
          via colorspacious. Grayscale is each color’s CIELAB L*. Color differences are CIEDE2000 (ΔE2000). The CVD tab
          also offers Brettel et al. (1997) and Viénot et al. (1999), and Machado et al. at partial severity, following
          the DaltonLens review.
        </p>
        <ol start={REF_NUMBERS.size + 1}>
          {METHOD_REFS.map((k) => (
            <RefItem key={k} k={k} />
          ))}
        </ol>
        <p className="muted small">{SOURCES_TEXT}</p>
      </details>
    );
  }),
);

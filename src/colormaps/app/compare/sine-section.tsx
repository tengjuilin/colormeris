import { useLayoutEffect, useRef } from 'react';
import { rgbToHex } from '../../../core/color.ts';
import type { ViewKey } from '../../../types/index.ts';
import { VIEWS } from '../../common.ts';
import { viewData } from '../../library-cache.ts';
import { colorsLut, paintValues, sinePattern } from '../../recolor.ts';
import { useTooltip } from '../shared/tooltip.tsx';
import { SINE_N, SINE_PATTERNS } from './compare-model.ts';
import type { Compared } from './compare-numbers.tsx';

// The sine-wave test images of the Compare tab: every compared map applied to
// the same pattern, in one of the five views. The canvases are painted in a
// layout effect when the map, its direction, the view or the pattern changes,
// and nothing else; hovering one shows the value and color in the page tooltip
// without rendering.

const valuesOf = new Map<string, Float32Array | number[]>(); // pattern key -> values, computed once
function patternValues(key: string) {
  let v = valuesOf.get(key);
  if (!v) valuesOf.set(key, (v = sinePattern(SINE_N, key)));
  return v;
}

function SineImage({ item, pattern, view }: { item: Compared; pattern: string; view: ViewKey }) {
  const { map, reversed } = item;
  const tip = useTooltip();
  const ref = useRef<HTMLCanvasElement>(null);
  const shown = useRef<ImageData | null>(null);
  const label = SINE_PATTERNS.find((p) => p.key === pattern)!.label.toLowerCase();

  useLayoutEffect(() => {
    const cv = ref.current;
    const g = cv?.getContext('2d');
    if (!cv || !g) return; // jsdom has no 2D context
    const colors = viewData(map, view, reversed).colors;
    const img = g.createImageData(SINE_N, SINE_N);
    paintValues(patternValues(pattern), colorsLut(colors, map.kind === 'qualitative'), img.data);
    g.putImageData(img, 0, 0);
    shown.current = img;
  }, [map, reversed, view, pattern]);

  return (
    <figure className="cmap-sine-fig">
      <canvas
        ref={ref}
        className="cmap-sine-img"
        width={SINE_N}
        height={SINE_N}
        role="img"
        aria-label={`${map.name} applied to the ${label} test image`}
        onPointerMove={(e) => {
          const img = shown.current;
          if (!img) return;
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.min(SINE_N - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * SINE_N)));
          const j = Math.min(SINE_N - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * SINE_N)));
          const k = (j * SINE_N + i) * 4;
          const c = [img.data[k], img.data[k + 1], img.data[k + 2]];
          const hex = rgbToHex(c);
          tip.showTip(
            {
              hex,
              title: map.name,
              text: [
                `value ${patternValues(pattern)[j * SINE_N + i].toFixed(3)}`,
                hex,
                `rgb(${c[0]}, ${c[1]}, ${c[2]})`,
              ],
            },
            e.clientX,
            e.clientY,
          );
        }}
        onPointerLeave={() => tip.hideTip()}
      />
      <figcaption>
        <code>{map.name}</code>
      </figcaption>
    </figure>
  );
}

// A row of pressed-state buttons.
function ChoiceTabs<K extends string>({
  label,
  options,
  current,
  onPick,
}: {
  label: string;
  options: readonly { key: K; label: string }[];
  current: K;
  onPick: (key: K) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: the same markup as the other tab rows
    <div className="cmap-tabs" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={o.key === current} onClick={() => onPick(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface SineSectionProps {
  list: Compared[];
  pattern: string;
  view: ViewKey;
  onPattern: (key: string) => void;
  onView: (key: ViewKey) => void;
}

export function SineSection({ list, pattern, view, onPattern, onView }: SineSectionProps) {
  return (
    <>
      <div className="cmap-sine-head">
        <h3>Sine wave test</h3>
        <ChoiceTabs label="Test image" options={SINE_PATTERNS} current={pattern} onPick={onPattern} />
        <ChoiceTabs label="View" options={VIEWS} current={view} onPick={onView} />
      </div>
      <p className="cmap-fig-cap muted">{SINE_PATTERNS.find((p) => p.key === pattern)!.cap}</p>
      <div>
        <div className="cmap-sine-grid">
          {list.map((item) => (
            <SineImage key={item.map.name} item={item} pattern={pattern} view={view} />
          ))}
        </div>
      </div>
    </>
  );
}

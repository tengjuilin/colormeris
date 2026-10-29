import { memo, useLayoutEffect, useRef } from 'react';
import type { Rgb } from '../../../types/index.ts';
import { paintStrip } from '../../strip-paint.ts';

// One strip canvas: a pixel per color, stretched by CSS (smoothed, or in blocks for
// qualitative maps). Drawn by strip-paint.ts `paintStrip`. Pass
// the cached color arrays from library-cache.ts, so the memo holds and the canvas
// is only painted again when the colors change.

export interface StripProps {
  colors: Rgb[];
  qualitative?: boolean;
}

export const Strip = memo(function Strip({ colors, qualitative = false }: StripProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const n = Math.max(1, colors.length);
  useLayoutEffect(() => {
    if (ref.current) paintStrip(ref.current, colors);
  }, [colors]);
  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a canvas is not focusable; decorative
    <canvas
      ref={ref}
      className={qualitative ? 'cmap-paint qual' : 'cmap-paint'}
      width={n}
      height={1}
      aria-hidden="true"
    />
  );
});

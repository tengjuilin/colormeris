import { type KeyboardEvent, type MouseEvent, type PointerEvent, useRef } from 'react';
import type { ColormapEntry, ViewKey } from '../../../types/index.ts';
import { VIEWS } from '../../common.ts';
import { viewData } from '../../library-cache.ts';
import { tipInfo } from '../../tooltip-core.ts';
import { Strip } from './strip.tsx';
import { useTooltip } from './tooltip.tsx';

// A colormap strip you can probe, with the markup of strips.ts makeStrip:
// hover shows the color's hex, rgb, position and L* in the page tooltip,
// click (or Enter / c) copies the hex, the arrow keys move by one sample
// (Shift by ten), Home and End jump. It has no `_cm` bag, so the viewer's
// delegated handlers (strips.ts) leave it alone.

export interface ProbeStripProps {
  map: ColormapEntry;
  view: ViewKey;
  reversed: boolean;
}

export function ProbeStrip({ map, view, reversed }: ProbeStripProps) {
  const tip = useTooltip();
  const probed = useRef<number | null>(null);
  const lastHex = useRef('');
  const marker = useRef<HTMLDivElement>(null);
  const label = VIEWS.find((v) => v.key === view)!.label;
  const vd = viewData(map, view, reversed);
  const n = vd.colors.length;

  const probe = (i: number, x: number, y: number) => {
    const m = marker.current;
    if (!m) return;
    m.style.left = `${((i + 0.5) / n) * 100}%`;
    probed.current = i;
    const info = tipInfo(map, label, vd.colors, vd.L!, i);
    lastHex.current = info.hex;
    tip.showTip(info, x, y, m);
  };
  const indexAt = (el: HTMLElement, clientX: number) => {
    const r = el.getBoundingClientRect();
    const f = r.width ? (clientX - r.left) / r.width : 0;
    return Math.max(0, Math.min(n - 1, Math.floor(f * n)));
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lastHex.current);
      tip.flashCopied();
    } catch (err) {
      console.warn('Could not copy', err);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    let i = probed.current ?? (e.key === 'ArrowLeft' ? n : -1);
    if (e.key === 'ArrowRight') i += e.shiftKey ? 10 : 1;
    else if (e.key === 'ArrowLeft') i -= e.shiftKey ? 10 : 1;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = n - 1;
    else if ((e.key === 'Enter' || e.key === 'c') && lastHex.current) {
      void copy();
      return;
    } else return;
    e.preventDefault();
    i = Math.max(0, Math.min(n - 1, i));
    const r = e.currentTarget.getBoundingClientRect();
    probe(i, r.left + ((i + 0.5) / n) * r.width, r.bottom - 12);
  };

  return (
    <div
      className="cmap-strip"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: arrow keys probe the strip
      tabIndex={0}
      role="img"
      aria-label={`${map.name} ${label}`}
      onPointerMove={(e: PointerEvent<HTMLDivElement>) =>
        probe(indexAt(e.currentTarget, e.clientX), e.clientX, e.clientY)
      }
      onClick={(e: MouseEvent<HTMLDivElement>) => {
        probe(indexAt(e.currentTarget, e.clientX), e.clientX, e.clientY);
        void copy();
      }}
      onKeyDown={onKeyDown}
      onBlur={() => tip.hideTip()}
    >
      <Strip colors={vd.colors} qualitative={map.kind === 'qualitative'} />
      <div className="cmap-marker" ref={marker} hidden />
    </div>
  );
}

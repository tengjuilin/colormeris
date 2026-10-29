import { type TipInfo, tipPosition } from './tooltip-core.ts';

// The page's one colormap tooltip (.cmap-tip), a singleton created on first use.
// The imperative strips (strips.ts) and the React TooltipProvider both drive it,
// so there is never a second element. Updated by hand: moving the pointer must
// not render anything.

export interface Tooltip {
  /** `marker` (a strip's position marker) is shown with the tip and hidden with it. */
  showTip: (info: Pick<TipInfo, 'hex' | 'title' | 'text'>, x: number, y: number, marker?: HTMLElement | null) => void;
  hideTip: () => void;
  /** Shows "Copied" for a moment. */
  flashCopied: () => void;
  /** Drops the pending "Copied" timer. */
  cancelCopied: () => void;
}

let tooltip: Tooltip | null = null;

function div(cls: string, text?: string) {
  const d = document.createElement('div');
  d.className = cls;
  if (text != null) d.textContent = text;
  return d;
}

export function getTooltip(): Tooltip {
  if (tooltip) return tooltip;
  const tip = div('cmap-tip');
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  const swatch = document.createElement('span');
  swatch.className = 'cmap-tip-swatch';
  const title = div('cmap-tip-title');
  const lines = div('cmap-tip-lines');
  const copied = div('cmap-tip-copied', 'Copied');
  copied.hidden = true;
  const head = div('cmap-tip-head');
  head.append(swatch, title);
  tip.append(head, lines, copied);
  document.body.append(tip);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let marker: HTMLElement | null = null;

  tooltip = {
    showTip(info, x, y, m) {
      if (marker && marker !== m) marker.hidden = true;
      marker = m ?? null;
      if (marker) marker.hidden = false;
      tip.hidden = false;
      swatch.style.background = info.hex;
      title.textContent = info.title;
      lines.replaceChildren(...info.text.map((t, k) => div(k === 0 ? 'cmap-tip-hex' : '', t)));
      copied.hidden = true;
      // Measure first, then keep the tooltip fully inside the viewport.
      const p = tipPosition(
        x,
        y,
        tip.offsetWidth,
        tip.offsetHeight,
        document.documentElement.clientWidth,
        window.innerHeight,
      );
      tip.style.left = `${p.left}px`;
      tip.style.top = `${p.top}px`;
    },
    hideTip() {
      tip.hidden = true;
      if (marker) marker.hidden = true;
      marker = null;
    },
    flashCopied() {
      copied.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(() => {
        copied.hidden = true;
      }, 1200);
    },
    cancelCopied() {
      clearTimeout(timer);
      copied.hidden = true;
    },
  };
  return tooltip;
}

/** For tests: forget the singleton (its element is removed with the document body). */
export function resetTooltipForTests() {
  tooltip = null;
}

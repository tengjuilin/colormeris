import { el } from '../../common.ts';
import type { FigureLine } from '../../figure-input.ts';
import { mountIsland } from '../mount-island.tsx';
import { RecolorTab, type RecolorTabProps } from './recolor-tab.tsx';

// Mounts the Recolor tab as a React island in a <section> that viewer.ts shows and hides.
export function mountRecolorTab(props: RecolorTabProps) {
  const sec: HTMLElement = el('section', {
    class: 'cmap-recolor',
    'aria-labelledby': 'cmap-recolor-title',
    hidden: '',
  });
  const island = mountIsland(sec, RecolorTab, props);
  let n = 0;
  return {
    sec,
    /** From Identify: load this figure and calibrate along its colorbar line. */
    open: (file: File, line: FigureLine | null) => island.update({ incoming: { id: ++n, file, line } }),
    unmount: island.unmount,
  };
}

export type { RecolorTabProps };

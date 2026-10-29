import { el } from '../../common.ts';
import { mountIsland } from '../mount-island.tsx';
import { IdentifyTab, type IdentifyTabProps } from './identify-tab.tsx';

// Mounts the Identify tab as a React island in a <section> that viewer.ts shows and hides.
export function mountIdentifyTab(props: IdentifyTabProps) {
  const sec: HTMLElement = el('section', {
    class: 'cmap-identify',
    'aria-labelledby': 'cmap-identify-title',
    hidden: '',
  });
  const island = mountIsland(sec, IdentifyTab, props);
  return { sec, setCompared: (compared: readonly string[]) => island.update({ compared }), unmount: island.unmount };
}

export type { IdentifyTabProps };

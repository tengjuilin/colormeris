import { el } from '../../common.ts';
import { mountIsland } from '../mount-island.tsx';
import { CvdTab, type CvdTabProps } from './cvd-tab.tsx';

// Mounts the CVD tab as a React island in a <section> that viewer.ts shows and hides.
export function mountCvdTab(props: CvdTabProps) {
  const sec: HTMLElement = el('section', { class: 'cmap-cvd', 'aria-labelledby': 'cmap-cvd-title', hidden: '' });
  const island = mountIsland(sec, CvdTab, props);
  return { sec, setActive: (active: boolean) => island.update({ active }), unmount: island.unmount };
}

export type { CvdTabProps };

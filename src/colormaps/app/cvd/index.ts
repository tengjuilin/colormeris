import { el } from '../../common.ts';
import { mountIsland } from '../mount-island.tsx';
import { CvdTab, type CvdTabProps } from './cvd-tab.tsx';

// Mounts the CVD tab as a React island in a <section> that viewer.ts shows and hides.
export function mountCvdTab(props: CvdTabProps) {
  const sec: HTMLElement = el('section', { class: 'cmap-cvd', 'aria-labelledby': 'cmap-cvd-title', hidden: '' });
  const island = mountIsland(sec, CvdTab, props);
  // The tab only needs to know when it is first shown (to load the example), so later
  // shows and hides render nothing: a tab switch must stay as cheap as flipping `hidden`.
  let activated = props.active;
  return {
    sec,
    setActive(active: boolean) {
      if (!active || activated) return;
      activated = true;
      island.update({ active });
    },
    unmount: island.unmount,
  };
}

export type { CvdTabProps };

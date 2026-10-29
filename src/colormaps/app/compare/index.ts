import { el } from '../../common.ts';
import { mountIsland } from '../mount-island.tsx';
import { CompareTab, type CompareTabProps } from './compare-tab.tsx';
import { CompareTray, type CompareTrayProps } from './compare-tray.tsx';

// Mounts the Compare tab as a React island in a <section> that viewer.ts shows and hides.
export function mountCompareTab(props: CompareTabProps) {
  const sec: HTMLElement = el('section', {
    class: 'cmap-compare',
    id: 'cmap-compare',
    'aria-labelledby': 'cmap-compare-count',
    hidden: '',
  });
  const island = mountIsland(sec, CompareTab, props);
  return { sec, update: (next: Partial<CompareTabProps>) => island.update(next), unmount: island.unmount };
}

// Mounts the comparison tray; `show` sets its visibility (and the body class that makes room for it).
export function mountCompareTray(props: CompareTrayProps) {
  const host: HTMLElement = el('div', { class: 'cmap-tray', hidden: '', role: 'region', 'aria-label': 'Comparison' });
  const island = mountIsland(host, CompareTray, props);
  return {
    host,
    update: (next: Partial<CompareTrayProps>, visible: boolean) => {
      host.hidden = !visible;
      document.body.classList.toggle('cmap-tray-on', visible);
      island.update(next);
    },
    unmount: island.unmount,
  };
}

export type { CompareTabProps, CompareTrayProps };

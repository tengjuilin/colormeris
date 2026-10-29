import { memo } from 'react';
import { VIEWER_TABS } from '../route.ts';

// The five tab links (<a href="#browse"> and so on). The link, not a click
// handler, changes the tab: useUrlSync listens for the hash change.

const TAB_TITLES: Record<string, string> = {
  browse: 'Browse',
  compare: 'Compare',
  identify: 'Identify',
  recolor: 'Recolor',
  cvd: 'CVD',
};

export const TabNav = memo(function TabNav({ tab, compareCount }: { tab: string; compareCount: number }) {
  return (
    <nav className="cmap-viewtabs" aria-label="Colormap tools">
      {VIEWER_TABS.map((t) => (
        <a key={t} href={`#${t}`} aria-current={t === tab ? 'page' : undefined}>
          {t === 'compare' && compareCount ? `Compare (${compareCount})` : TAB_TITLES[t]}
        </a>
      ))}
    </nav>
  );
});

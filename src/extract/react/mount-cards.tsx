// Mounts the React sidebar cards into their section shells in extract.html. The workspace keeps owning each
// section's `hidden` attribute; React owns the children. Cards register here as they are migrated.
import { type ComponentType, StrictMode, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { SettingsSource } from '../../types/index.ts';
import { SettingsProvider } from '../../ui/index.ts';
import { ColorbarCard } from '../workspace/cards/colorbar-card.tsx';
import { GridCard } from '../workspace/cards/grid-card.tsx';
import { HeatmapResultsCard } from '../workspace/cards/heatmap-results-card.tsx';
import { PanelsCard } from '../workspace/cards/panels-card.tsx';
import { useSectionVisible, useWorkspace, WsContext, type WsContextValue } from './use-workspace.ts';

/** [id of the section shell, card component]. */
export const CARD_REGISTRY: [sectionId: string, Component: ComponentType][] = [
  ['sec-panels', PanelsCard],
  ['sec-grid', GridCard],
  ['sec-colorbar', ColorbarCard],
  ['sec-hm-results', HeatmapResultsCard],
];

// A card renders nothing until its section is first shown (sections stay hidden until a file is loaded), so
// page load pays only for React itself. Once shown it stays mounted, keeping drafts and <details> state.
function WhenShown({ section, Card }: { section: string; Card: ComponentType }) {
  useWorkspace({ section, light: false });
  const shown = useRef(false);
  if (useSectionVisible(section)) shown.current = true;
  return shown.current ? <Card /> : null;
}

// One root per section: calling mountCards again re-renders into the same roots.
const roots = new Map<string, Root>();

export function mountCards(ctx: WsContextValue, settings: SettingsSource) {
  // flushSync: a shown card's ids exist when this returns, before the imperative setup that follows.
  flushSync(() => {
    for (const [sectionId, Card] of CARD_REGISTRY) {
      const section = document.getElementById(sectionId);
      if (!section) throw new Error(`mountCards: no section #${sectionId}`);
      let root = roots.get(sectionId);
      if (!root) roots.set(sectionId, (root = createRoot(section)));
      root.render(
        <StrictMode>
          <WsContext.Provider value={ctx}>
            <SettingsProvider source={settings}>
              <WhenShown section={sectionId} Card={Card} />
            </SettingsProvider>
          </WsContext.Provider>
        </StrictMode>,
      );
    }
  });
}

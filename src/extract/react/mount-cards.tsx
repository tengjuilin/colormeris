// Mounts the React sidebar cards into their section shells in extract.html. The workspace keeps owning each
// section's `hidden` attribute; React owns the children. Cards register here as they are migrated.
import { type ComponentType, StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { SettingsSource } from '../../types/index.ts';
import { SettingsProvider } from '../../ui/index.ts';
import { PanelsCard } from '../workspace/cards/panels-card.tsx';
import { WsContext, type WsContextValue } from './use-workspace.ts';

/** [id of the section shell, card component]. */
export const CARD_REGISTRY: [sectionId: string, Component: ComponentType][] = [['sec-panels', PanelsCard]];

// One root per section: calling mountCards again re-renders into the same roots.
const roots = new Map<string, Root>();

export function mountCards(ctx: WsContextValue, settings: SettingsSource) {
  // flushSync: the cards' ids exist when this returns, before the imperative setup that follows.
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
              <Card />
            </SettingsProvider>
          </WsContext.Provider>
        </StrictMode>,
      );
    }
  });
}

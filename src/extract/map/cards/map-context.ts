// How the Map cards reach the tool's shared context (`mctx`, made in map-tool.ts). Cards are mounted with no
// props, so setupMapTool registers its context here; tests register a fake one.
import { useSyncExternalStore } from 'react';
import type { MapToolContext } from '../map-tool.ts';

let current: MapToolContext | null = null;

export function setMapToolContext(mctx: MapToolContext | null) {
  current = mctx;
}

export function useMapTool(): MapToolContext {
  // The context never changes once set; the hook only reads it.
  const mctx = useSyncExternalStore(
    () => () => {},
    () => current,
  );
  if (!mctx) throw new Error('useMapTool: setupMapTool has not run');
  return mctx;
}

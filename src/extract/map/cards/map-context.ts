// How the Map cards reach the tool's shared context (`mctx`, made in map-tool.ts). setupMapTool registers it
// before the cards mount; tests register a fake one.
import { createToolContext } from '../../react/tool-context.ts';
import type { MapToolContext } from '../map-tool.ts';

const mapContext = createToolContext<MapToolContext>('setupMapTool');

export const setMapToolContext = mapContext.set;
export const useMapTool = mapContext.get;

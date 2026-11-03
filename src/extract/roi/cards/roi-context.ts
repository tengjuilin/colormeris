// The ROI tool's private context (state, selection, colors) for its React cards. setupRoiTool sets it before
// the cards mount; the cards read it during render and in handlers.
import { createToolContext } from '../../react/tool-context.ts';
import type { RoiToolContext } from '../roi-tool.ts';

const roiContext = createToolContext<RoiToolContext>('setupRoiTool');

export const setRoiContext = roiContext.set;
export const useRoiContext = roiContext.get;

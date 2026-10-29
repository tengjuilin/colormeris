// The ROI tool's private context (state, selection, colors) for its React cards. setupRoiTool sets it before
// the cards mount; the cards read it during render and in handlers.
import type { RoiToolContext } from '../roi-tool.ts';

let current: RoiToolContext | null = null;

export function setRoiContext(ctx: RoiToolContext) {
  current = ctx;
}

export function useRoiContext(): RoiToolContext {
  if (!current) throw new Error('useRoiContext: setupRoiTool has not run');
  return current;
}
